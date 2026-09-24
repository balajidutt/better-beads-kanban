from __future__ import annotations

import json
import os
import sys
import unittest
from pathlib import Path
from unittest import mock

from support.fixtures import FixtureTestCase, isolated_environment, run_git, write_json
from support.github_fixtures import (
    REPO_ROOT, SHA, REF, install_fake_gh, job_data, policy_data, responses_for,
    run_data, runs_endpoint, write_state,
)

sys.path.insert(0, str(REPO_ROOT / "assets"))
import github_pipeline as github
import pipeline_policy as policy


class GitHubPipelineTests(FixtureTestCase):
    def setUp(self):
        self.fixture = self.enterContext(isolated_environment(prefix="github pipeline "))
        self.repo = self.fixture.root / "repository with spaces"
        self.repo.mkdir()
        self.env = self.fixture.env.copy()
        self.env["FAKE_GH_STATE"] = str(self.fixture.root / "api.json")
        self.env["FAKE_GH_LOG"] = str(self.fixture.root / "calls.jsonl")
        self.enterContext(mock.patch.dict(os.environ, self.env, clear=True))
        run_git(self.repo, "init", "-b", "main", env=self.env)
        run_git(self.repo, "remote", "add", "origin", "https://github.com/sample/project.git", env=self.env)
        self.policy_path = write_json(self.repo / policy.POLICY_PATH, policy_data())
        self.state_path = Path(self.env["FAKE_GH_STATE"])
        self.log_path = Path(self.env["FAKE_GH_LOG"])
        install_fake_gh(self.fixture.fake_bin, self.state_path, self.log_path)
        self.responses = responses_for()
        self.extra = {}

    def check(self, **kwargs):
        write_state(self.state_path, self.responses, **self.extra)
        return github.check_workflows(self.repo, policy.load_github_policy(self.repo, "main"), SHA, REF, **kwargs)

    def calls(self):
        return [json.loads(line) for line in self.log_path.read_text().splitlines()] if self.log_path.exists() else []

    def test_workflow_success_does_not_reconstruct_matrix_job_count(self):
        for count in (0, 1, 6, 103):
            with self.subTest(jobs=count):
                run = run_data()
                jobs = [job_data(run, job_id=1000 + index, conclusion="failure" if index == 1 else "skipped" if index == 2 else "success") for index in range(count)]
                self.responses = responses_for(run, jobs)
                result = self.check()
                self.assertEqual(result["outcome"], "success")
                self.assertEqual(len(result["workflows"][0]["jobs"]), count)
        self.assertTrue(all(call["argv"][0] == "api" for call in self.calls()))

    def test_missing_active_and_terminal_results(self):
        for status, conclusion, expected in (("queued", None, "retryable"), ("in_progress", None, "retryable"), ("completed", "cancelled", "terminal"), ("completed", "failure", "terminal")):
            self.responses = responses_for(run_data(status=status, conclusion=conclusion))
            self.assertEqual(self.check()["outcome"], expected)
        self.responses[runs_endpoint(run_data())] = {"total_count": 0, "workflow_runs": []}
        self.assertEqual(self.check()["outcome"], "retryable")

    def test_wrong_run_identity_never_substitutes(self):
        for key, value in (("head_sha", "b" * 40), ("head_branch", "main"), ("event", "pull_request"), ("workflow_id", 18), ("path", ".github/workflows/other.yml"), ("repository", {"id": 29, "full_name": "other/repository"}), ("head_repository", {"id": 30, "full_name": "sample/project"}), ("run_attempt", True)):
            with self.subTest(field=key):
                self.responses = responses_for()
                self.responses[runs_endpoint(run_data())]["workflow_runs"][0][key] = value
                with self.assertRaises(policy.PipelineError):
                    self.check()

    def test_newer_failed_run_beats_older_success_and_pinned_record(self):
        newest = run_data(run_id=42, created_at="2026-01-02T00:00:00Z", conclusion="failure")
        self.responses = responses_for(newest)
        self.responses[runs_endpoint(newest)] = {"total_count": 2, "workflow_runs": [run_data(), newest]}
        self.assertEqual(self.check()["outcome"], "terminal")
        with self.assertRaisesRegex(policy.PipelineError, "superseded"):
            self.check(expected_runs=[{"workflow_id": 17, "run_id": 41, "run_attempt": 1}])

    def test_attempt_changes_fail_closed(self):
        self.responses["repos/sample/project/actions/runs/41"] = run_data(attempt=2)
        with self.assertRaises(policy.PipelineError):
            self.check()

    def test_api_errors_overflow_and_timeout_do_not_echo_payloads(self):
        self.extra = {"error_text": "synthetic-private-token-do-not-log"}
        for response in ({"fake_exit": 4}, {"fake_raw": "not JSON"}, {"fake_raw": "[]"}, {"fake_raw": "x" * (github.MAX_RESPONSE + 1)}, {"fake_sleep": 2}):
            with self.subTest(response=list(response)):
                write_json(self.policy_path, policy_data(timeout_seconds=1))
                self.responses = {"repos/sample/project": response}
                with self.assertRaises(policy.PipelineError) as caught:
                    self.check()
                self.assertNotIn(self.extra["error_text"], str(caught.exception))

    def test_pagination_rejects_missing_duplicate_and_excess_entries(self):
        for response in ({"total_count": 301, "workflow_runs": []}, {"total_count": 1, "workflow_runs": []}, {"total_count": 2, "workflow_runs": [run_data(), run_data()]}, {"total_count": True, "workflow_runs": []}):
            self.responses = responses_for()
            self.responses[runs_endpoint(run_data())] = response
            with self.assertRaises(policy.PipelineError):
                self.check()

    def test_account_pin_is_child_scoped(self):
        os.environ.update({"GH_TOKEN": "synthetic-foo", "GITHUB_TOKEN": "synthetic-conflict", "GH_DEBUG": "api"})
        run_git(self.repo, "config", "--local", "pipeline-guard.githubAccount", "bar", env=self.env)
        self.extra = {"accounts": {"bar": "synthetic-bar"}, "expected_env": {"GH_TOKEN": "synthetic-bar", "GITHUB_TOKEN": None}}
        self.assertEqual(self.check()["outcome"], "success")
        calls = self.calls()
        self.assertEqual(calls[0]["argv"], ["auth", "token", "--hostname", "github.com", "--user", "bar"])
        self.assertTrue(all(all(call["token_matches"].values()) for call in calls[1:]))
        self.assertEqual(os.environ["GH_TOKEN"], "synthetic-foo")
        self.assertNotIn("synthetic-bar", self.log_path.read_text())

    def test_policy_and_remote_identity_are_strict(self):
        for changes in ({"provider": "unknown"}, {"workflows": []}, {"workflows": [True]}, {"workflows": [17, 17]}, {"schema_version": True}, {"timeout_seconds": 0}, {"extra": "rejected"}, {"guarded_ref": "refs/heads/../main"}):
            write_json(self.policy_path, policy_data(**changes))
            with self.assertRaises(policy.PipelineError):
                policy.load_github_policy(self.repo)
        write_json(self.policy_path, policy_data())
        selected = policy.load_github_policy(self.repo)
        for url in ("git@github.com:sample/project.git", "ssh://git@GITHUB-BALAJIDUTT/sample/project", "https://github.com/sample/project.git"):
            self.assertEqual(policy.remote_identity(url), ("github.com", "sample/project"))
        for url in ("git@alias:sample/project", "https://github-balajidutt/sample/project", "https://github.com/other/project", "file:///tmp/local", "https://token@github.com/sample/project"):
            run_git(self.repo, "remote", "set-url", "origin", url, env=self.env)
            with self.assertRaises(policy.PipelineError):
                policy.validate_remote(self.repo, selected)
        run_git(self.repo, "remote", "set-url", "origin", "git@github-balajidutt:sample/project.git", env=self.env)
        run_git(self.repo, "remote", "set-url", "--push", "origin", "https://github.com/sample/project", env=self.env)
        policy.validate_remote(self.repo, selected)
        run_git(self.repo, "remote", "set-url", "--add", "--push", "origin", "https://github.com/other/project", env=self.env)
        with self.assertRaises(policy.PipelineError):
            policy.validate_remote(self.repo, selected)


if __name__ == "__main__":
    unittest.main()
