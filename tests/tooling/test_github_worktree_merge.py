from __future__ import annotations

import json
import unittest
from pathlib import Path

from support.agent_wt_merge_fixtures import GitFixture, load_helper_module
from unittest import mock
from support.fixtures import read_json, write_json
from support.github_fixtures import configure_github_fixture, responses_for, run_data, write_state


class GitHubWorktreeMergeTests(unittest.TestCase):
    def test_inspection_does_not_read_legacy_beads_state(self):
        helper = load_helper_module()
        with mock.patch.object(helper, "read_json", side_effect=AssertionError("legacy state read")):
            result = helper.inspect_all_beads(original_worktree=Path("/synthetic"), repo_root=Path("/synthetic"), feature_branch="topic", target_ref="topic")
        self.assertIsNone(result["opencode"]["exists"])
        self.assertFalse(result["opencode"]["matches"])

    def test_helper_owned_closure_is_rejected_before_repository_access(self):
        helper = load_helper_module()
        with mock.patch.object(helper, "resolve_repo_root", side_effect=AssertionError("repository access")) as resolve:
            for merge_type in ("ff", "no-ff"):
                args = ["--actor", "opencode", "--close-beads", "bbk-example"]
                if merge_type == "no-ff":
                    args.extend(["-m", "Synthetic merge"])
                with self.assertRaisesRegex(helper.AgentWtMergeError, "helper-owned Beads closure is disabled"):
                    helper.perform_merge(args, merge_type=merge_type, helper=None)
            resolve.assert_not_called()

    def fixture(self):
        fixture = GitFixture()
        self.addCleanup(fixture.cleanup)
        api, log = configure_github_fixture(fixture)
        return fixture, api, log

    def test_prepare_ff_merge_and_shared_receipt(self):
        fixture, api, _ = self.fixture()
        before = fixture.output(fixture.main, "rev-parse", "HEAD")
        sha = fixture.commit_feature("feature.txt", "feature\n", "feature")
        write_state(api, responses_for(run_data(sha=sha, ref="refs/heads/feature")))
        prepared = fixture.run_helper(fixture.main_helper, fixture.feature, "prepare-ci", "--poll-interval", "1", "--poll-timeout", "1")
        self.assertEqual(prepared.returncode, 0, prepared.stdout + prepared.stderr)
        self.assertEqual(fixture.remote_feature_sha(), sha)
        inspected = fixture.run_helper(fixture.main_helper, fixture.feature, "inspect", "--json")
        store = Path(json.loads(inspected.stdout)["pipeline"]["evidence_store"])
        merged = fixture.run_helper(fixture.main_helper, fixture.feature, "ff", "--actor", "opencode")
        self.assertEqual(merged.returncode, 0, merged.stdout + merged.stderr)
        self.assertEqual(fixture.output(fixture.main, "rev-parse", "HEAD"), sha)
        self.assertIsNone(fixture.remote_feature_sha())
        self.assertEqual(fixture.remote_ref_sha("refs/heads/main"), before)
        receipt = read_json(next(store.glob("*.json")))
        self.assertEqual((receipt["before_sha"], receipt["landing_sha"]), (before, sha))
        self.assertEqual(list(store.glob(".active-*")), [])

    def test_divergent_no_ff_uses_agent_identity_without_pushing_main(self):
        fixture, api, _ = self.fixture()
        remote = fixture.remote_ref_sha("refs/heads/main")
        sha = fixture.commit_feature("feature.txt", "feature\n", "feature")
        before = fixture.commit_main("main-only.txt", "main\n", "main-only")
        write_state(api, responses_for(run_data(sha=sha, ref="refs/heads/feature")))
        prepared = fixture.run_helper(fixture.main_helper, fixture.feature, "prepare-ci")
        self.assertEqual(prepared.returncode, 0, prepared.stderr)
        merged = fixture.run_helper(fixture.main_helper, fixture.feature, "no-ff", "--actor", "opencode", "-m", "Land fixture")
        self.assertEqual(merged.returncode, 0, merged.stdout + merged.stderr)
        self.assertEqual(fixture.output(fixture.main, "rev-parse", "HEAD^1"), before)
        self.assertEqual(fixture.output(fixture.main, "rev-parse", "HEAD^2"), sha)
        self.assertEqual(fixture.output(fixture.main, "log", "-1", "--format=%an|%cn"), "OpenCode|OpenCode")
        self.assertEqual(fixture.remote_ref_sha("refs/heads/main"), remote)

    def test_terminal_ci_retains_feature_and_does_not_merge(self):
        fixture, api, _ = self.fixture()
        before = fixture.output(fixture.main, "rev-parse", "HEAD")
        sha = fixture.commit_feature("feature.txt", "feature\n", "feature")
        write_state(api, responses_for(run_data(sha=sha, ref="refs/heads/feature", conclusion="failure")))
        prepared = fixture.run_helper(fixture.main_helper, fixture.feature, "prepare-ci", "--poll-interval", "1", "--poll-timeout", "1")
        self.assertEqual(prepared.returncode, 2)
        self.assertEqual(fixture.output(fixture.main, "rev-parse", "HEAD"), before)
        self.assertEqual(fixture.remote_feature_sha(), sha)

    def test_feature_bootstrap_and_canonical_selection(self):
        fixture, api, _ = self.fixture()
        fixture.git(fixture.main, "rm", "assets/agent-wt-merge")
        fixture.commit_all(fixture.main, "remove fixture main helper")
        inspected = fixture.run_helper(fixture.feature_helper, fixture.feature, "inspect", "--json")
        self.assertEqual(inspected.returncode, 0, inspected.stderr)
        self.assertEqual(json.loads(inspected.stdout)["helper"]["state"], "fallback")
        fixture.install_helper(fixture.main)
        fixture.commit_all(fixture.main, "restore fixture main helper")
        inspected = fixture.run_helper(fixture.feature_helper, fixture.feature, "inspect", "--json")
        self.assertEqual(inspected.returncode, 0, inspected.stderr)
        self.assertEqual(json.loads(inspected.stdout)["helper"]["state"], "delegated")


if __name__ == "__main__":
    unittest.main()
