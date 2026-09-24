"""Scoped standard-library fixtures adapted from the licensed dotfiles support."""

from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
import unittest
from contextlib import contextmanager
from dataclasses import dataclass
from pathlib import Path

if sys.version_info < (3, 10):
    raise RuntimeError("Workflow tooling tests require Python 3.10 or newer")


@dataclass(frozen=True)
class IsolatedEnvironment:
    root: Path
    home: Path
    fake_bin: Path
    env: dict[str, str]


class FixtureTestCase(unittest.TestCase):
    def enterContext(self, context):
        value = context.__enter__()
        self.addCleanup(context.__exit__, None, None, None)
        return value


def write_executable(path: Path, content: str) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(content, encoding="utf-8")
    path.chmod(0o755)
    return path


def write_json(path: Path, payload: object) -> Path:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, indent=2, sort_keys=True) + "\n", encoding="utf-8")
    return path


def read_json(path: Path) -> object:
    return json.loads(path.read_text(encoding="utf-8"))


@contextmanager
def isolated_environment(*, prefix: str = "bbk-tooling-"):
    parent = Path(tempfile.gettempdir()) / "opencode"
    parent.mkdir(exist_ok=True)
    with tempfile.TemporaryDirectory(prefix=prefix, dir=parent) as temporary:
        root = Path(temporary).resolve()
        home, fake_bin, tmp = root / "home", root / "bin", root / "tmp"
        for directory in (home, fake_bin, tmp, root / "empty-template"):
            directory.mkdir()
        empty = root / "empty-gitconfig"
        empty.write_text("", encoding="utf-8")
        env = {name: value for name, value in os.environ.items() if name in {"PATH", "SystemRoot", "WINDIR", "COMSPEC", "PATHEXT", "LANG", "LC_ALL"}}
        env.update({
            "HOME": str(home), "USERPROFILE": str(home),
            "XDG_CONFIG_HOME": str(home / ".config"), "XDG_CACHE_HOME": str(home / ".cache"),
            "XDG_DATA_HOME": str(home / ".local/share"), "XDG_STATE_HOME": str(home / ".local/state"),
            "TMPDIR": str(tmp), "TMP": str(tmp), "TEMP": str(tmp),
            "PATH": str(fake_bin) + os.pathsep + env.get("PATH", os.defpath),
            "GIT_CONFIG_GLOBAL": str(empty), "GIT_CONFIG_SYSTEM": str(empty),
            "GIT_TEMPLATE_DIR": str(root / "empty-template"), "GIT_TERMINAL_PROMPT": "0",
            "PYTHONDONTWRITEBYTECODE": "1",
        })
        for name in ("bd", "dolt"):
            write_executable(fake_bin / name, "#!/bin/sh\nexit 97\n")
        yield IsolatedEnvironment(root, home, fake_bin, env)


def run_git(cwd: Path, *args: str, env=None, check=True):
    result = subprocess.run(["git", *args], cwd=cwd, env=env, check=False, text=True,
                            stdout=subprocess.PIPE, stderr=subprocess.PIPE, timeout=30)
    if len(result.stdout) + len(result.stderr) > 1048576:
        raise AssertionError("fixture Git output exceeded its limit")
    if check and result.returncode:
        raise AssertionError(f"fixture git failed: {args!r}\n{result.stderr}")
    return result
