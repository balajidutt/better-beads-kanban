from __future__ import annotations

import os
import sys
import unittest
from pathlib import Path
from unittest import mock

from support.fixtures import FixtureTestCase, isolated_environment, run_git, write_json
from support.github_fixtures import REPO_ROOT, policy_data

sys.path.insert(0, str(REPO_ROOT / "assets"))
from pipeline_evidence import EvidenceStore
from pipeline_policy import PipelineError, load_github_policy


class PipelineEvidenceTests(FixtureTestCase):
    def setUp(self):
        self.fixture = self.enterContext(isolated_environment(prefix="pipeline evidence "))
        self.enterContext(mock.patch.dict(os.environ, self.fixture.env, clear=True))
        self.repo = self.fixture.root / "main"
        self.repo.mkdir()
        self.git("init", "-b", "main")
        self.git("config", "user.name", "Fixture")
        self.git("config", "user.email", "fixture@example.test")
        write_json(self.repo / "configs/pipeline-guard.json", policy_data())
        self.git("add", ".")
        self.git("commit", "-m", "base")
        self.before = self.git("rev-parse", "HEAD")
        (self.repo / "feature").write_text("feature\n")
        self.git("add", ".")
        self.git("commit", "-m", "feature")
        self.sha = self.git("rev-parse", "HEAD")
        self.policy = load_github_policy(self.repo)
        self.store = EvidenceStore(self.repo)
        self.result = {"outcome": "success", "provider": "github", "host": "github.com", "repository": "sample/project", "repository_id": 29, "policy_fingerprint": self.policy.fingerprint, "sha": self.sha, "source_ref": "refs/heads/topic", "workflows": [{"workflow_id": 17, "path": ".github/workflows/build.yml", "run_id": 41, "run_attempt": 1}]}

    def git(self, *args):
        return run_git(self.repo, *args, env=self.fixture.env).stdout.strip()

    def test_shared_store_survives_owned_feature_removal(self):
        feature = self.fixture.root / "linked worktree"
        self.git("worktree", "add", "-b", "topic", str(feature))
        store = EvidenceStore(feature)
        self.assertEqual(store.path, self.store.path)
        receipt = store.save(self.policy, self.result, before_sha=self.before, landing_sha=self.sha)
        self.git("worktree", "remove", str(feature))
        self.assertTrue(Path(receipt).exists())
        self.assertEqual(self.store.records()[0]["landing_sha"], self.sha)
        if os.name != "nt":
            self.assertEqual(Path(receipt).stat().st_mode & 0o777, 0o600)

    def test_failed_atomic_replace_keeps_previous_receipt(self):
        receipt = Path(self.store.save(self.policy, self.result))
        original = receipt.read_bytes()
        with mock.patch("pipeline_evidence.os.replace", side_effect=OSError("synthetic write failure")):
            with self.assertRaises(PipelineError):
                self.store.save(self.policy, self.result, before_sha=self.before, landing_sha=self.sha)
        self.assertEqual(receipt.read_bytes(), original)
        self.assertEqual(list(self.store.path.glob(".write-*")), [])

    def test_locks_and_active_operations_are_owned(self):
        token = self.store.start_operation()
        with self.store.lock():
            with self.assertRaisesRegex(PipelineError, "locked"):
                self.store.save(self.policy, self.result)
        self.store.finish_operation(token)
        self.assertEqual(list(self.store.path.iterdir()), [])

    def test_corrupt_records_and_non_success_are_rejected(self):
        receipt = Path(self.store.save(self.policy, self.result))
        receipt.write_text("{")
        with self.assertRaises(PipelineError):
            self.store.records()
        for outcome in ("bypass", "retryable", "terminal"):
            with self.assertRaises(PipelineError):
                self.store.save(self.policy, dict(self.result, outcome=outcome))


if __name__ == "__main__":
    unittest.main()
