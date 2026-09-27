import test from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
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
