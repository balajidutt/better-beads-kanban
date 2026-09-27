import test from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import vscodeTestPaths from '../../scripts/lib/vscode-test-paths.js';
import workflowProcess from '../../scripts/lib/workflow-process.js';

const repoRoot = fileURLToPath(new URL('../../', import.meta.url));
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

function fixtureRepos(t) {
  const base = realpathSync(mkdtempSync(path.join(tmpdir(), 'bbk-vscode-cache-')));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const emptyConfig = path.join(base, 'empty-gitconfig');
  const emptyTemplate = path.join(base, 'empty-template');
  writeFileSync(emptyConfig, '');
  mkdirSync(emptyTemplate);
  const env = {
    ...workflowProcess.gitEnvironment(),
    GIT_CONFIG_GLOBAL: emptyConfig, GIT_CONFIG_SYSTEM: emptyConfig, GIT_TEMPLATE_DIR: emptyTemplate,
  };
  const git = (cwd, ...args) => execFileSync('git', ['-c', 'user.name=t', '-c', 'user.email=t@example.invalid', ...args],
    { cwd, env, stdio: 'ignore', timeout: 30000 });
  return { base, git };
}

test('linked worktrees share the main checkout download cache; other layouts keep their own', async t => {
  const { base, git } = fixtureRepos(t);
  const main = path.join(base, 'main');
  const linked = path.join(main, '.claude', 'worktrees', 'feature');
  const nested = path.join(main, 'vendor', 'copy');
  const plain = path.join(base, 'plain');
  const separate = path.join(base, 'separate');
  for (const dir of [main, nested, plain, separate]) mkdirSync(dir, { recursive: true });
  git(main, 'init', '-q');
  git(main, 'commit', '-q', '--allow-empty', '--no-verify', '-m', 'init');
  git(main, 'worktree', 'add', '-q', '-b', 'feature', linked);
  git(separate, 'init', '-q', `--separate-git-dir=${path.join(base, 'separate-store')}`);

  assert.equal(await vscodeTestPaths.vscodeCachePath(main), path.join(main, '.vscode-test'));
  assert.equal(await vscodeTestPaths.vscodeCachePath(linked), path.join(main, '.vscode-test'));
  assert.equal(await vscodeTestPaths.vscodeCachePath(nested), path.join(nested, '.vscode-test'));
  assert.equal(await vscodeTestPaths.vscodeCachePath(separate), path.join(separate, '.vscode-test'));
  assert.equal(await vscodeTestPaths.vscodeCachePath(plain), path.join(plain, '.vscode-test'));
});

test('the suite config and the visual harness use the shared profile and cache helpers', async () => {
  const config = (await import('../../.vscode-test.mjs')).default.tests[0];
  assert.equal(config.cachePath, await vscodeTestPaths.vscodeCachePath(path.dirname(fileURLToPath(new URL('../../.vscode-test.mjs', import.meta.url)))));
  assert.ok(config.launchArgs.includes(`--user-data-dir=${vscodeTestPaths.profileDir('vsct', path.resolve(repoRoot))}`));
  const harness = readFileSync(path.join(repoRoot, 'scripts', 'visual-test-harness.js'), 'utf8');
  assert.match(harness, /--user-data-dir=' \+ userDataDir/);
  assert.match(harness, /var userDataDir = vscodeTestPaths\.profileDir\('vsch', PROJECT_ROOT\);/);
  assert.match(harness, /cachePath: await vscodeTestPaths\.vscodeCachePath\(PROJECT_ROOT\)/);
});
