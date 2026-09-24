from __future__ import annotations

import json
import subprocess
import sys
import unittest

from support.agent_wt_merge_fixtures import GitFixture
from support.fixtures import read_json
from support.github_fixtures import REPO_ROOT, configure_github_fixture, responses_for, run_data, write_state


class PipelineGuardTests(unittest.TestCase):
    def fixture(self):
        fixture = GitFixture()
        self.addCleanup(fixture.cleanup)
        api, log = configure_github_fixture(fixture)
        return fixture, api, log

    def hook(self, fixture, text, url="git@github.com:sample/project.git", cwd=None):
        return subprocess.run(["sh", str(REPO_ROOT / "scripts/hooks/pre-push"), "origin", url],
                              input=text, cwd=cwd or fixture.main, env=fixture.env, text=True,
                              capture_output=True, timeout=30, check=False)

    def land(self, fixture, api):
        before = fixture.output(fixture.main, "rev-parse", "HEAD")
        sha = fixture.commit_feature("feature.txt", "feature\n", "feature")
        run = run_data(sha=sha, ref="refs/heads/feature")
        write_state(api, responses_for(run))
        for args in [("prepare-ci", "--poll-interval", "1", "--poll-timeout", "1"), ("ff", "--actor", "opencode")]:
            result = fixture.run_helper(fixture.main_helper, fixture.feature, *args)
            self.assertEqual(result.returncode, 0, result.stdout + result.stderr)
        return before, sha, run

    def test_main_push_revalidates_receipt_without_publishing(self):
        fixture, api, _ = self.fixture()
        before, sha, run = self.land(fixture, api)
        record = f"refs/heads/main {sha} refs/heads/main {before}\n"
        checked = self.hook(fixture, record)
        self.assertEqual(checked.returncode, 0, checked.stderr)
        self.assertEqual(fixture.remote_ref_sha("refs/heads/main"), before)
        write_state(api, responses_for(dict(run, conclusion="failure")))
        self.assertEqual(self.hook(fixture, record).returncode, 1)
        self.assertEqual(fixture.remote_ref_sha("refs/heads/main"), before)

    def test_feature_push_skips_api_but_policy_alone_installs_no_hook(self):
        fixture, api, log = self.fixture()
        sha = fixture.output(fixture.feature, "rev-parse", "HEAD")
        self.assertFalse((fixture.main / ".git/hooks/pre-push").exists())
        result = self.hook(fixture, f"refs/heads/feature {sha} refs/heads/feature {'0' * 40}\n", cwd=fixture.feature)
        self.assertEqual(result.returncode, 0, result.stderr)
        self.assertFalse(log.exists())

    def test_fork_main_is_not_the_maintainer_identity(self):
        fixture, api, _ = self.fixture()
        before, sha, _ = self.land(fixture, api)
        fixture.git(fixture.main, "remote", "set-url", "origin", "https://github.com/contributor/fork.git")
        result = self.hook(fixture, f"refs/heads/main {sha} refs/heads/main {before}\n", url="https://github.com/contributor/fork.git")
        self.assertEqual(result.returncode, 1)
        self.assertIn("do not agree", result.stderr)

    def test_single_checkout_feature_push_requires_checked_out_main(self):
        fixture, api, log = self.fixture()
        fixture.git(fixture.main, "switch", "-c", "single-checkout")
        sha = fixture.output(fixture.main, "rev-parse", "HEAD")
        result = self.hook(fixture, f"refs/heads/single-checkout {sha} refs/heads/single-checkout {'0' * 40}\n")
        self.assertEqual(result.returncode, 1)
        self.assertIn("authoritative main worktree", result.stderr)
        self.assertFalse(log.exists())

    def test_missing_runtime_cannot_be_treated_as_inert(self):
        fixture, api, _ = self.fixture()
        before, sha, _ = self.land(fixture, api)
        (fixture.main / "assets/github_pipeline.py").unlink()
        result = self.hook(fixture, f"refs/heads/main {sha} refs/heads/main {before}\n")
        self.assertEqual(result.returncode, 1)
        self.assertIn("restore the documented", result.stderr)
        self.assertNotIn("Traceback", result.stderr)


if __name__ == "__main__":
    unittest.main()
