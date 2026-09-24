"""Selected GitFixture operations from the licensed merge-helper test suite."""

from __future__ import annotations

import os
import shutil
import subprocess
import sys
from importlib.machinery import SourceFileLoader
from importlib.util import module_from_spec, spec_from_loader
from pathlib import Path

from support.fixtures import isolated_environment, run_git, write_json


REPO_ROOT = Path(__file__).resolve().parents[3]
SOURCE_HELPER = REPO_ROOT / "assets/agent-wt-merge"


def load_helper_module():
    name = "agent_wt_merge_test_module"
    loader = SourceFileLoader(name, str(SOURCE_HELPER))
    spec = spec_from_loader(name, loader)
    module = module_from_spec(spec)
    sys.modules[name] = module
    sys.path.insert(0, str(SOURCE_HELPER.parent))
    try:
        loader.exec_module(module)
    finally:
        sys.path.pop(0)
    return module


class GitFixture:
    def __init__(self, *, feature_commit=False, ci_gated=False):
        self.context = isolated_environment(prefix="bbk merge ")
        self.isolated = self.context.__enter__()
        self.root = self.isolated.root
        self.env = self.isolated.env.copy()
        self.main = self.root / "main worktree"
        self.feature = self.root / "feature worktree"
        self.remote = self.root / "origin remote.git"
        self.fake_bin = self.isolated.fake_bin
        self.main.mkdir()
        self.git(self.main, "init", "-b", "main")
        self.git(self.main, "config", "user.name", "Fixture")
        self.git(self.main, "config", "user.email", "fixture@example.test")
        self.install_helper(self.main)
        (self.main / "base.txt").write_text("base\n", encoding="utf-8")
        self.commit_all(self.main, "initial fixture")
        self.git(self.root, "init", "--bare", "-b", "main", str(self.remote))
        self.git(self.main, "remote", "add", "origin", str(self.remote))
        self.git(self.main, "push", "-u", "origin", "main")
        self.git(self.main, "worktree", "add", "-b", "feature", str(self.feature))
        if feature_commit:
            self.commit_feature("feature.txt", "feature\n", "feature")

    @property
    def main_helper(self):
        return self.main / "assets/agent-wt-merge"

    @property
    def feature_helper(self):
        return self.feature / "assets/agent-wt-merge"

    def cleanup(self):
        self.context.__exit__(None, None, None)

    def git(self, cwd, *args, check=True):
        if not Path(cwd).resolve().is_relative_to(self.root):
            raise AssertionError("fixture command escaped its owned root")
        return run_git(cwd, *args, env=self.env, check=check)

    def output(self, cwd, *args):
        return self.git(cwd, *args).stdout.strip()

    def install_helper(self, worktree):
        destination = worktree / "assets/agent-wt-merge"
        destination.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(SOURCE_HELPER, destination)
        return destination

    def install_pipeline_files(self, worktree):
        write_json(worktree / "configs/gitlab-pipeline-guard.json", {
            "$schema": "./schemas/gitlab-pipeline-guard.v1.schema.json", "schema_version": 1,
            "api_url": "http://127.0.0.1:1/api/v4", "project_id": 1,
            "guarded_remote": "origin", "guarded_ref": "refs/heads/main",
            "required_job": "fixture", "timeout_seconds": 1,
        })

    def commit_all(self, cwd, message):
        self.git(cwd, "add", "-A")
        self.git(cwd, "commit", "-m", message)
        return self.output(cwd, "rev-parse", "HEAD")

    def commit_feature(self, name, content, message):
        (self.feature / name).write_text(content, encoding="utf-8")
        return self.commit_all(self.feature, message)

    def commit_main(self, name, content, message):
        (self.main / name).write_text(content, encoding="utf-8")
        return self.commit_all(self.main, message)

    def remote_ref_sha(self, ref):
        text = self.output(self.main, "ls-remote", "--heads", "origin", ref)
        return text.split()[0] if text else None

    def remote_feature_sha(self):
        return self.remote_ref_sha("refs/heads/feature")

    def run_helper(self, helper, cwd, *args):
        if "--close-beads" in args:
            raise AssertionError("Beads closure is outside this fixture's scope")
        env = {name: value for name, value in self.env.items() if not name.startswith("AGENT_WT_MERGE_")}
        return subprocess.run([str(helper), *args], cwd=cwd, env=env, text=True,
                              stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30, check=False)
