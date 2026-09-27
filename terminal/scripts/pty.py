#!/usr/bin/env python3
"""Linux-only, stdlib PTY acceptance tests for an already-built dist/cli.mjs.

Run: python3 terminal/scripts/pty.py (Node 22+ must be on PATH).
All bd responses and repository markers are temporary filesystem fixtures.
"""

import codecs
import errno
import fcntl
import json
import os
from pathlib import Path
import re
import select
import shutil
import signal
import struct
import subprocess
import sys
import tempfile
import termios
import time
import unicodedata


SAFETY = ["--readonly", "--sandbox", "--dolt-auto-commit", "off"]
FAKE_BD = r"""
const fs = require('node:fs');
const path = require('node:path');
const argv = process.argv.slice(2);
const root = __dirname;
const mode = fs.readFileSync(path.join(root, 'mode'), 'utf8');
const log = (event, extra = {}) => fs.appendFileSync(path.join(root, 'calls'),
  JSON.stringify({event, pid: process.pid, argv, cwd: process.cwd(), ...extra}) + '\n');
process.on('exit', code => log('exit', {code}));
const cmd = argv[0];
const stubborn = (mode === 'stubborn' && cmd === 'show') ||
  (['timeout', 'overflow', 'stderr-overflow'].includes(mode) && cmd === 'list');
if (stubborn) process.on('SIGTERM', () => log('SIGTERM'));
log('start');
const send = value => process.stdout.write(JSON.stringify(value));
const cards = Array.from({length: 32}, (_, i) => ({
  id: `pty-${String(i).padStart(2, '0')}`, title: `Fixture ${String(i).padStart(2, '0')}`,
  description: `Detail body ${i}`, status: i === 31 ? 'closed' : 'open',
  priority: 2, issue_type: 'task', labels: ['fixture'],
  created_at: '2026-01-01T00:00:00Z', updated_at: '2026-01-01T00:00:00Z'
}));
if (cmd === 'version') send({version: '1.2.2'});
else if (cmd === 'context') send({repo_root: root, cwd_repo_root: root,
  beads_dir: path.join(root, '.beads')});
else if (cmd === 'list') {
  if (mode === 'malformed') process.stdout.write('{not json');
  else if (mode === 'unavailable') {
    process.stderr.write('fixture backend unavailable'); process.exitCode = 7;
  } else if (mode === 'timeout') setInterval(() => {}, 1000);
  else if (mode === 'overflow' || mode === 'stderr-overflow') {
    const stream = mode === 'overflow' ? process.stdout : process.stderr;
    let remaining = 51 * 1024 * 1024;
    const chunk = Buffer.alloc(64 * 1024, 'x');
    const pump = () => {
      while (remaining > 0) {
        remaining -= chunk.length;
        if (!stream.write(chunk)) { stream.once('drain', pump); return; }
      }
      log('overflow-written');
    };
    setInterval(() => {}, 1000);
    pump();
  } else send(cards);
} else if (cmd === 'show') {
  if (mode === 'stubborn') setInterval(() => {}, 1000);
  else setTimeout(() => send(cards.filter(card => card.id === argv[2])),
    mode === 'slow' ? 1200 : 15);
} else { log('forbidden'); process.exitCode = 90; }
"""


def require(condition, message):
    if not condition:
        raise AssertionError(message)


class Screen:
    """Small VT screen model for Ink's cursor movement and erase sequences."""

    def __init__(self, width, height):
        self.width, self.height = width, height
        self.lines = [[" "] * width for _ in range(height)]
        self.x = self.y = 0
        self.pending = ""
        self.cursor_visible = True
        self.saw_hidden = False

    def resize(self, width, height):
        self.width, self.height = width, height
        self.lines = [(row + [" "] * width)[:width] for row in self.lines[:height]]
        self.lines += [[" "] * width for _ in range(height - len(self.lines))]
        self.x, self.y = min(self.x, width - 1), min(self.y, height - 1)

    def newline(self):
        self.y += 1
        if self.y >= self.height:
            self.lines.pop(0)
            self.lines.append([" "] * self.width)
            self.y = self.height - 1

    def feed(self, text):
        self.pending += text
        while self.pending:
            ch = self.pending[0]
            if ch == "\x1b":
                match = re.match(r"\x1b\[([0-?]*)([ -/]*)([@-~])", self.pending)
                if match:
                    self.csi(match[1], match[3])
                    self.pending = self.pending[match.end():]
                    continue
                if self.pending.startswith("\x1b]"):
                    end = re.search(r"\x07|\x1b\\", self.pending)
                    if not end:
                        return
                    self.pending = self.pending[end.end():]
                    continue
                if len(self.pending) < 2 or self.pending.startswith("\x1b["):
                    return
                self.pending = self.pending[2:]
                continue
            self.pending = self.pending[1:]
            if ch == "\r":
                self.x = 0
            elif ch == "\n":
                self.newline()
            elif ch == "\b":
                self.x = max(0, self.x - 1)
            elif ch == "\t":
                self.x = min(self.width - 1, (self.x // 8 + 1) * 8)
            elif ord(ch) >= 32 and not unicodedata.combining(ch):
                if self.x >= self.width:
                    self.x = 0
                    self.newline()
                self.lines[self.y][self.x] = ch
                self.x += 2 if unicodedata.east_asian_width(ch) in ("W", "F") else 1

    def csi(self, params, command):
        if params == "?25" and command in ("h", "l"):
            self.cursor_visible = command == "h"
            self.saw_hidden |= command == "l"
            return
        if params.startswith("?"):
            return
        values = [int(value or 0) for value in params.split(";")]
        n = values[0] or 1
        if command == "A":
            self.y = max(0, self.y - n)
        elif command in ("B", "E"):
            self.y = min(self.height - 1, self.y + n)
        elif command == "F":
            self.y = max(0, self.y - n)
        elif command == "C":
            self.x = min(self.width - 1, self.x + n)
        elif command == "D":
            self.x = max(0, self.x - n)
        elif command in ("G", "`"):
            self.x = min(self.width - 1, n - 1)
        elif command in ("H", "f"):
            self.y = min(self.height - 1, n - 1)
            self.x = min(self.width - 1, (values[1] or 1) - 1) if len(values) > 1 else 0
        elif command == "J":
            if values[0] == 2:
                self.lines = [[" "] * self.width for _ in range(self.height)]
            elif values[0] == 0:
                self.lines[self.y][self.x:] = [" "] * (self.width - self.x)
                for row in range(self.y + 1, self.height):
                    self.lines[row] = [" "] * self.width
        elif command == "K":
            start = 0 if values[0] in (1, 2) else min(self.x, self.width)
            end = min(self.x + 1, self.width) if values[0] == 1 else self.width
            self.lines[self.y][start:end] = [" "] * (end - start)
        if command in ("E", "F"):
            self.x = 0

    @property
    def text(self):
        return "\n".join("".join(row).rstrip() for row in self.lines)


class Session:
    def __init__(self, cli, node, mode="normal", missing=False):
        self.temp = tempfile.TemporaryDirectory(prefix="beads-pty-")
        self.root = Path(self.temp.name)
        self.master = self.slave = None
        self.process = None
        self.screen = Screen(100, 30)
        self.output = ""
        self.decoder = codecs.getincrementaldecoder("utf-8")("replace")
        try:
            (self.root / ".beads").mkdir()
            (self.root / ".beads" / "metadata.json").write_text("{}")
            (self.root / "mode").write_text(mode)
            (self.root / "calls").touch()
            fake = self.root / "bd"
            fake.write_text("#!" + node + "\n" + FAKE_BD)
            fake.chmod(0o755)
            self.master, self.slave = os.openpty()
            fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", 30, 100, 0, 0))
            self.baseline = termios.tcgetattr(self.slave)
            env = os.environ.copy()
            env.update(TERM="xterm-256color", FORCE_COLOR="1", CI="false")

            def controlling_tty():
                os.setsid()
                fcntl.ioctl(0, termios.TIOCSCTTY, 0)
                os.tcsetpgrp(0, os.getpgrp())

            self.process = subprocess.Popen(
                [node, str(cli), "--repo", str(self.root), "--bd-path",
                 str(self.root / "missing-bd" if missing else fake), "--clipboard", "manual"],
                cwd=self.root, env=env, stdin=self.slave, stdout=self.slave,
                stderr=self.slave, preexec_fn=controlling_tty, close_fds=True)
        except BaseException:
            self.close()
            raise

    def __enter__(self):
        return self

    def __exit__(self, kind, error, traceback):
        if error:
            print("\n--- PTY screen ---\n" + self.screen.text, file=sys.stderr)
            print("--- PTY output tail ---\n" + repr(self.output[-5000:]), file=sys.stderr)
            print("--- fake bd events ---\n" + json.dumps(self.events(), indent=2), file=sys.stderr)
        self.close()

    def pump(self, seconds=0.05):
        deadline = time.monotonic() + seconds
        while time.monotonic() < deadline:
            ready, _, _ = select.select([self.master], [], [], max(0, deadline - time.monotonic()))
            if not ready:
                break
            try:
                data = os.read(self.master, 65536)
            except OSError as error:
                if error.errno == errno.EIO:
                    break
                raise
            if not data:
                break
            text = self.decoder.decode(data)
            self.output = (self.output + text)[-200000:]
            self.screen.feed(text)

    def wait(self, predicate, label, timeout=5):
        deadline = time.monotonic() + timeout
        while time.monotonic() < deadline:
            self.pump()
            if predicate():
                return
        raise AssertionError("Timed out waiting for " + label)

    def expect(self, text, timeout=5):
        self.wait(lambda: text in self.screen.text, repr(text), timeout)

    def expect_view(self, view):
        tabs = '  '.join(name.upper() if name == view else name
                         for name in ('tree', 'table', 'kanban'))
        self.expect(f' {tabs}   Focus: MAIN')

    def send(self, text):
        require(self.process.poll() is None, "CLI exited before keyboard input")
        os.write(self.master, text.encode())
        self.pump(0.08)

    def resize(self, width, height):
        self.screen.resize(width, height)
        fcntl.ioctl(self.slave, termios.TIOCSWINSZ, struct.pack("HHHH", height, width, 0, 0))
        os.kill(self.process.pid, signal.SIGWINCH)

    def events(self):
        lines = (self.root / "calls").read_text().splitlines()
        return [json.loads(line) for line in lines if line.endswith("}")]

    def starts(self, command=None):
        return [event for event in self.events() if event["event"] == "start"
                and (command is None or event["argv"][0] == command)]

    def active(self):
        return [event["pid"] for event in self.starts() if Path("/proc", str(event["pid"])).exists()]

    def check_commands(self):
        for event in self.starts():
            args = event["argv"]
            allowed = args == ["version", "--json"] or args == ["context", "--json"] + SAFETY
            allowed |= args == ["list", "--json", "--all", "--limit", "1001"] + SAFETY
            allowed |= (len(args) == 7 and args[:2] == ["show", "--json"]
                        and re.fullmatch(r"pty-\d{2}", args[2]) is not None and args[3:] == SAFETY)
            require(allowed, "Forbidden bd argv: " + repr(args))
            require(event["cwd"] == str(self.root), "bd escaped fixture cwd")
        require(not any(event["event"] == "forbidden" for event in self.events()), "Mutation attempted")

    def raw(self):
        attrs = termios.tcgetattr(self.slave)
        require(not attrs[3] & (termios.ICANON | termios.ECHO), "CLI did not enter raw mode")
        require(self.screen.saw_hidden, "CLI never hid cursor")

    def finish(self, action="q", code=0, rendered=True):
        if action == "SIGTERM":
            os.kill(self.process.pid, signal.SIGTERM)
        elif action:
            self.send(action)
        self.wait(lambda: self.process.poll() is not None, "CLI exit", 5)
        self.pump(0.1)
        require(self.process.returncode == code,
                f"Expected exit {code}, got {self.process.returncode}")
        require(termios.tcgetattr(self.slave) == self.baseline, "Terminal attributes were not restored")
        if rendered:
            require(self.screen.saw_hidden, "Cursor-hide assertion was not exercised")
            require(self.screen.cursor_visible, "Cursor still hidden after exit")
        self.wait(lambda: not self.active(), "all fake bd PIDs reaped", 2)
        self.check_commands()

    def close(self):
        if self.process is not None:
            try:
                os.killpg(self.process.pid, signal.SIGKILL)
            except ProcessLookupError:
                pass
            self.process.wait(timeout=5)
        for fd in (self.master, self.slave):
            if fd is not None:
                os.close(fd)
        self.temp.cleanup()


def interaction(cli, node):
    with Session(cli, node) as s:
        s.expect("31 matching / 32 loaded")
        s.expect("ID: pty-00")
        s.expect_view("tree")
        s.raw()
        s.send("v")
        s.expect_view("table")
        s.wait(lambda: re.search(r'ID\s+Title\s+Status\s+Pri\s+Type', s.screen.text),
               "table column headings")
        s.send("v")
        s.expect_view("kanban")
        s.expect("Open (31)")
        s.expect("● pty-00 P2")
        s.send("v")
        s.expect_view("tree")
        s.wait(lambda: re.search(r'●\s+pty-00.*\[P2\s*\].*\[task\s*\]', s.screen.text),
               "selected tree row with priority and type badges")
        s.send("j")
        s.expect("ID: pty-01")
        s.send("k")
        s.expect("ID: pty-00")
        s.send("/")
        s.expect("Search (Esc/Enter finish)")
        s.send("Fixture 07")
        s.expect("1 matching / 32 loaded")
        s.send("\r")
        s.expect("ID: pty-07")
        footer = 'j/k move · / search · f filters · r refresh · y copy · q exit'
        s.expect(footer)
        selected = [line for line in s.screen.text.splitlines() if '●' in line]
        require(len(selected) == 1 and 'pty-07' in selected[0], "Expected selected pty-07 row")
        copied_at = time.monotonic()
        s.send("y")
        s.expect("Copy manually: pty-07")
        require("\x1b]52;" not in s.output, "Manual copy emitted OSC 52")
        require(footer not in s.screen.text, "Copy notice did not replace normal footer")
        s.pump(max(0, 3.5 - (time.monotonic() - copied_at)))
        require("Copy manually: pty-07" in s.screen.text, "Copy notice expired before four seconds")
        s.wait(lambda: "Copy manually: pty-07" not in s.screen.text and footer in s.screen.text,
               "four-second copy notice expiry and normal footer restoration", 2)
        elapsed = time.monotonic() - copied_at
        require(3.8 <= elapsed <= 5.5, f"Copy notice expiry took {elapsed:.2f}s, expected four seconds")
        require([line for line in s.screen.text.splitlines() if '●' in line] == selected,
                "Copy notice expiry changed the selected row")
        s.expect("ID: pty-07")
        s.send("v")
        s.expect_view("table")
        s.resize(80, 20)
        s.expect("Resize terminal: minimum 100×24")
        s.expect("Current 80×20")
        s.send("v")
        s.resize(120, 36)
        s.expect_view("table")
        s.expect("Search: Fixture 07")
        s.expect("ID: pty-07")
        s.expect("1 matching / 32 loaded")
        s.send("f")
        s.expect("[Status]")
        s.send("n")
        s.expect("0 matching / 32 loaded")
        s.send("a")
        s.expect("1 matching / 32 loaded")
        s.send("\t")
        s.expect("[Priority]")
        s.send("n")
        s.expect("0 matching / 32 loaded")
        s.send("r")
        s.expect("31 matching / 32 loaded")
        s.send("\t")
        s.expect("[Type]")
        s.send("\r")
        s.send("?")
        s.expect("Kanban columns use stored status.")
        s.send("\r")
        s.send("\t")
        s.expect("Focus: DETAILS")
        s.send("\t")
        s.expect("Focus: MAIN")
        before = len(s.starts("list"))
        s.send("r")
        s.wait(lambda: len(s.starts("list")) == before + 1, "manual refresh")
        s.expect("ID: pty-00")
        s.finish()


def rapid_navigation(cli, node):
    with Session(cli, node, "slow") as s:
        s.wait(lambda: bool(s.starts("show")), "initial delayed detail")
        for _ in range(12):
            s.send("j")
        s.expect("ID: pty-12", 6)
        active = set()
        peak = 0
        for event in s.events():
            if event["argv"][0] != "show":
                continue
            if event["event"] == "start":
                active.add(event["pid"])
                peak = max(peak, len(active))
            elif event["event"] == "exit":
                active.discard(event["pid"])
        require(peak == 1, f"Detail concurrency was {peak}, expected exactly one")
        require(len(s.starts("show")) >= 2, "Rapid navigation did not fetch another detail")
        s.finish()


def stubborn_exit(cli, node, action):
    with Session(cli, node, "stubborn") as s:
        s.expect("Loading details…")
        s.wait(lambda: bool(s.starts("show")), "stubborn child startup")
        s.raw()
        pid = s.starts("show")[0]["pid"]
        start = time.monotonic()
        s.finish(action)
        events = [event for event in s.events() if event["pid"] == pid]
        require(any(event["event"] == "SIGTERM" for event in events), "Child never received SIGTERM")
        require(not any(event["event"] == "exit" for event in events),
                "Stubborn child exited voluntarily; SIGKILL path was not exercised")
        require(time.monotonic() - start < 4, "Forced child cleanup exceeded its deadline")


def backend_error(cli, node, mode, expected):
    with Session(cli, node, mode) as s:
        start = time.monotonic()
        s.expect(expected, 35 if mode == "timeout" else 10)
        s.expect("STALE")
        s.expect("0 matching / 0 loaded")
        if mode == "timeout":
            require(time.monotonic() - start >= 29, "Timeout did not exercise the real 30-second deadline")
        if mode in ("timeout", "overflow", "stderr-overflow"):
            s.wait(lambda: not s.active(), "failed read child reaped")
            require(any(event["event"] == "SIGTERM" for event in s.events()),
                    "Failed read did not terminate its stubborn child")
        require(not s.starts("show"), "Detail requested after failed initial snapshot")
        s.finish()


def missing_bd(cli, node):
    with Session(cli, node, missing=True) as s:
        s.wait(lambda: "ENOENT" in s.output, "missing executable diagnostic")
        require("Beads terminal:" in s.output, "Missing startup error prefix")
        s.finish(action=None, code=1, rendered=False)
        require(not s.starts(), "Missing executable test invoked bd")


def main():
    require(sys.platform.startswith("linux"), "PTY tests must run in disposable Linux, not on the host")
    cli = Path(__file__).resolve().parents[1] / "dist" / "cli.mjs"
    require(cli.is_file(), "Build terminal/dist/cli.mjs before running PTY tests")
    node = shutil.which("node")
    require(node is not None, "Node 22+ must be on PATH")
    version = subprocess.check_output([node, "--version"], text=True).strip()
    require(int(version.lstrip("v").split(".")[0]) >= 22, "Node 22+ is required")
    tests = [
        ("views, keyboard, search, filters, manual copy, resize and q", lambda: interaction(cli, node)),
        ("rapid navigation serializes detail reads", lambda: rapid_navigation(cli, node)),
        ("q kills stubborn detail and restores TTY", lambda: stubborn_exit(cli, node, "q")),
        ("Ctrl-C kills stubborn detail and restores TTY", lambda: stubborn_exit(cli, node, "\x03")),
        ("SIGTERM kills stubborn detail and restores TTY", lambda: stubborn_exit(cli, node, "SIGTERM")),
        ("missing bd", lambda: missing_bd(cli, node)),
        ("malformed JSON", lambda: backend_error(cli, node, "malformed", "bd returned invalid JSON output")),
        ("unavailable backend", lambda: backend_error(cli, node, "unavailable", "fixture backend unavailable")),
        ("real stdout overflow", lambda: backend_error(cli, node, "overflow", "Command output exceeded 52428800 bytes limit")),
        ("real stderr overflow", lambda: backend_error(cli, node, "stderr-overflow", "Command error output exceeded 52428800 bytes limit")),
        ("real 30-second timeout", lambda: backend_error(cli, node, "timeout", "Command timed out after 30000ms")),
    ]
    start = time.monotonic()
    for name, test in tests:
        print("RUN " + name, flush=True)
        test()
        print("PASS " + name, flush=True)
    print(f"PASS {len(tests)} PTY scenarios in {time.monotonic() - start:.1f}s", flush=True)


if __name__ == "__main__":
    try:
        main()
    except (AssertionError, OSError, subprocess.SubprocessError) as error:
        print(f"FAIL: {error}", file=sys.stderr)
        sys.exit(1)
