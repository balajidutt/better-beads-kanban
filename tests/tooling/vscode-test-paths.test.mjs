import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import vscodeTestPaths from '../../scripts/lib/vscode-test-paths.js';

const worktreeRoot = '/Users/example/Documents/development/Beads-Kanban/.claude/worktrees/a-feature-branch-with-a-long-name';

test('profile directory keeps the VS Code IPC socket under the 103-character macOS limit from a worktree', () => {
  const socket = path.join(vscodeTestPaths.profileDir('vsch', worktreeRoot), '1.13-main.sock');
  assert.ok(socket.length <= 103, `${socket.length}: ${socket}`);
  assert.ok(path.join(worktreeRoot, '.vscode-test', 'user-data', '1.13-main.sock').length > 103);
});

test('profile directories differ per checkout and per launcher', () => {
  const other = `${worktreeRoot}-2`;
  assert.notEqual(vscodeTestPaths.profileDir('vsch', worktreeRoot), vscodeTestPaths.profileDir('vsch', other));
  assert.notEqual(vscodeTestPaths.profileDir('vsch', worktreeRoot), vscodeTestPaths.profileDir('vsct', worktreeRoot));
});

test('the extension suite profile keeps its established tmpdir location', () => {
  const expected = path.join(tmpdir(), `vsct-${createHash('sha256').update(worktreeRoot).digest('hex').slice(0, 8)}`);
  assert.equal(vscodeTestPaths.profileDir('vsct', worktreeRoot), expected);
});

test('linked worktrees share the main checkout download cache; non-git directories keep their own', t => {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'bbk-vscode-cache-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const main = path.join(base, 'main');
  const linked = path.join(main, '.claude', 'worktrees', 'feature');
  const plain = path.join(base, 'plain');
  mkdirSync(main);
  mkdirSync(plain);
  const git = (...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', '-c', 'commit.gpgsign=false', ...args],
    { cwd: main, stdio: 'ignore', timeout: 30000 });
  git('init', '-q');
  git('commit', '-q', '--allow-empty', '-m', 'init');
  git('worktree', 'add', '-q', '-b', 'feature', linked);

  assert.equal(vscodeTestPaths.vscodeCachePath(main), path.join(main, '.vscode-test'));
  assert.equal(vscodeTestPaths.vscodeCachePath(linked), path.join(main, '.vscode-test'));
  assert.equal(vscodeTestPaths.vscodeCachePath(plain), path.join(plain, '.vscode-test'));
});
