import test from 'node:test';
import assert from 'node:assert/strict';
import { chmod, copyFile, mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scratch } from './support/fixtures.mjs';
import release from '../../scripts/release-preflight.js';
import processTools from '../../scripts/lib/workflow-process.js';

async function fixture(t, changes = {}) {
  const root = await scratch(t);
  await mkdir(path.join(root, '.git'));
  await mkdir(path.join(root, 'src'));
  await mkdir(path.join(root, 'scripts/lib'), { recursive: true });
  for (const name of ['release-fork-vsix.sh', 'release-preflight.js', 'lib/workflow-process.js']) await writeFile(path.join(root, 'scripts', name), 'fixture tooling\n');
  await writeFile(path.join(root, 'package.json'), JSON.stringify({ name: 'better-beads-kanban', displayName: 'Better Beads Kanban', version: '9.8.7' }));
  await writeFile(path.join(root, 'src/webview.ts'), "const version = '9.8.7';\n");
  await writeFile(path.join(root, 'CHANGELOG.md'), '## [9.8.7] - 2026-09-24\n');
  const source = await realpath(root);
  const state = { head: 'a'.repeat(40), remote: 'b'.repeat(40), dependencies: ['bbk-one'], ready: true, issueStatus: 'open', issueType: 'task', dirty: '', ancestor: true, tag: false, missingObject: false, apiFailure: false, ignored: [], ...changes };
  const calls = [];
  const http = (status, value) => ({ code: status === 200 ? 0 : 1, stdout: `HTTP/2.0 ${status}\ncontent-type: application/json\n\n${JSON.stringify(value)}`, stderr: 'SYNTHETIC_PRIVATE_DIAGNOSTIC' });
  const execute = async (command, args, options) => {
    calls.push([command, args]);
    if (command === 'git') {
      if (args.includes('--git-common-dir')) return { code: 0, stdout: path.join(source, '.git') };
      if (args.includes('--show-toplevel')) return { code: 0, stdout: source };
      if (args.includes('HEAD')) return { code: 0, stdout: state.head };
      if (args.includes('ls-files')) return { code: 0, stdout: 'tracked' };
      if (args.includes('status')) return { code: 0, stdout: args.includes('--ignored=matching') ? state.dirty || state.ignored.map(name => `!! ${name}\0`).join('') : '' };
      if (args.includes('cat-file')) return { code: state.missingObject ? 1 : 0, stdout: '' };
      if (args.includes('merge-base')) {
        assert.deepEqual(args, ['merge-base', '--is-ancestor', state.head, state.remote]);
        return { code: state.ancestor ? 0 : 1, stdout: '' };
      }
      if (args.includes('show-ref')) return { code: state.tag ? 0 : 1, stdout: '' };
    }
    if (command === 'bd' || command === 'bd.exe') {
      assert.deepEqual(args.slice(0, 3), ['-C', source, '--readonly']);
      assert.equal(Object.keys(options.env).some(name => /^(BEADS_|BD_|DOLT_)/.test(name)), false);
      if (args.includes('context')) return { code: 0, stdout: JSON.stringify({ beads_dir: path.join(source, '.beads') }) };
      if (args.includes('show')) return { code: 0, stdout: JSON.stringify([{ id: 'bbk-release', status: state.issueStatus, issue_type: state.issueType }]) };
      if (args.includes('dep')) return { code: 0, stdout: JSON.stringify(state.dependencies.map(id => ({ id, dependency_type: 'blocks' }))) };
      if (args.includes('ready')) return { code: 0, stdout: JSON.stringify(state.ready ? [{ id: 'bbk-release' }] : []) };
    }
    if (command === 'gh') {
      const endpoint = args.at(-1);
      if (state.apiFailure) return http(503, { message: 'SYNTHETIC_PRIVATE' });
      if (endpoint === `repos/${release.REPOSITORY}`) return http(200, { full_name: release.REPOSITORY });
      if (endpoint.endsWith('/git/ref/heads/main')) return http(200, { ref: 'refs/heads/main', object: { type: 'commit', sha: state.remote } });
      return http(404, { message: 'Not Found' });
    }
    throw new Error('Unexpected fixture command');
  };
  return { root, source, tooling: source, execute, state, calls, issue: 'bbk-release' };
}

test('release preflight accepts a ready scoped task and proves ancestry against fresh API SHA', async t => {
  const data = await fixture(t);
  const result = await release.preflight(data);
  assert.equal(result.sourceSha, data.state.head);
  assert.equal(result.remoteMain, data.state.remote);
  assert.deepEqual(result.scope, ['bbk-one']);
  assert.equal(result.asset, 'better-beads-kanban-9.8.7.vsix');
  assert.equal(data.calls.some(([, args]) => args.includes('fetch') || args.includes('push') || args.includes('origin/main')), false);
});

test('release preflight refuses nonready, empty-scope, dirty, unavailable and reused-tag states', async t => {
  for (const [changes, code] of [
    [{ ready: false }, 'RELEASE_TASK_NOT_READY'],
    [{ dependencies: [] }, 'RELEASE_SCOPE_INVALID'],
    [{ dependencies: ['bbk-one', 'bbk-one'] }, 'RELEASE_SCOPE_INVALID'],
    [{ issueStatus: 'in_progress' }, 'RELEASE_TASK_NOT_OPEN'],
    [{ issueType: 'epic' }, 'RELEASE_TASK_NOT_OPEN'],
    [{ dirty: ' M package.json\0' }, 'SOURCE_DIRTY'],
    [{ ancestor: false }, 'SOURCE_NOT_PROVEN_ON_REMOTE_MAIN'],
    [{ missingObject: true }, 'GIT_INSPECTION_FAILED'],
    [{ tag: true }, 'TAG_ALREADY_EXISTS'],
    [{ apiFailure: true }, 'GITHUB_QUERY_FAILED']
  ]) {
    const data = await fixture(t, changes);
    await assert.rejects(release.preflight(data), error => error.code === code && !error.message.includes('SYNTHETIC_PRIVATE'), code);
    assert.equal(data.calls.some(([, args]) => args.includes('create') || args.includes('update') || args.includes('fetch') || args.includes('push')), false);
  }
});

test('release metadata mismatches and output collisions fail before publication', async t => {
  const data = await fixture(t);
  await writeFile(path.join(data.root, 'src/webview.ts'), "const version = '1.0.0';");
  await assert.rejects(release.preflight(data), { code: 'WEBVIEW_VERSION_MISMATCH' });
  await writeFile(path.join(data.root, 'src/webview.ts'), "const version = '9.8.7';");
  await writeFile(path.join(data.root, 'CHANGELOG.md'), '## [1.0.0]\n');
  await assert.rejects(release.preflight(data), { code: 'CHANGELOG_VERSION_MISMATCH' });
  await writeFile(path.join(data.root, 'CHANGELOG.md'), '## [9.8.7]\n');
  await writeFile(path.join(data.root, 'SHA256SUMS'), 'pre-existing');
  await assert.rejects(release.preflight(data), { code: 'OUTPUT_COLLISION' });
});

test('post-build snapshots reject changed scope and unexpected outputs but allow fresh main advancement', async t => {
  const data = await fixture(t);
  const expected = await release.preflight(data);
  data.state.ignored = ['out/', expected.asset, 'SHA256SUMS'];
  data.state.remote = 'c'.repeat(40);
  assert.equal((await release.preflight({ ...data, expected })).remoteMain, data.state.remote);
  data.state.dependencies.push('bbk-two');
  await assert.rejects(release.preflight({ ...data, expected }), { code: 'RELEASE_SNAPSHOT_CHANGED' });
  data.state.dependencies.pop();
  data.state.ignored.push('unapproved-output/');
  await assert.rejects(release.preflight({ ...data, expected }), { code: 'UNEXPECTED_BUILD_OUTPUT' });
});

test('release helper flags reject duplicate, unknown and malformed snapshot inputs', () => {
  assert.deepEqual(release.argumentsFor(['--release-issue', 'bbk-release']), { issue: 'bbk-release', expected: null });
  for (const args of [['--release-issue'], ['--unknown', 'x'], ['--release-issue', 'one', '--release-issue', 'two'], ['--expected-snapshot', '']]) assert.throws(() => release.argumentsFor(args));
});

async function wrapperFixture(t, changes = {}) {
  const root = await scratch(t);
  const source = path.join(await realpath(root), 'source');
  await mkdir(path.join(source, '.git'), { recursive: true });
  await mkdir(path.join(source, 'src'));
  await mkdir(path.join(source, 'scripts/lib'), { recursive: true });
  await mkdir(path.join(source, 'node_modules/.bin'), { recursive: true });
  const bin = path.join(root, 'bin');
  await mkdir(bin);
  for (const name of ['release-fork-vsix.sh', 'release-preflight.js', 'lib/workflow-process.js']) {
    await copyFile(new URL(`../../scripts/${name}`, import.meta.url), path.join(source, 'scripts', name));
  }
  for (const name of ['git', 'gh', 'bd', 'npm']) {
    await copyFile(new URL('./support/fake-command.js', import.meta.url), path.join(bin, name));
    await chmod(path.join(bin, name), 0o755);
  }
  const vsce = path.join(source, 'node_modules/.bin/vsce');
  await copyFile(new URL('./support/fake-command.js', import.meta.url), vsce);
  await chmod(vsce, 0o755);
  await writeFile(path.join(source, 'package.json'), JSON.stringify({ name: 'better-beads-kanban', displayName: 'Fixture', version: '9.8.7' }));
  await writeFile(path.join(source, 'src/webview.ts'), "const version = '9.8.7';\n");
  await writeFile(path.join(source, 'CHANGELOG.md'), '## [9.8.7]\n');
  const log = path.join(root, 'calls.jsonl');
  const stateFile = path.join(root, 'state.json');
  const state = { source, log, sha: 'a'.repeat(40), account: 'fixture-user', ...changes };
  await writeFile(stateFile, JSON.stringify(state));
  return { source, stateFile, log, env: { PATH: `${bin}:${path.dirname(process.execPath)}:/usr/bin:/bin`, HOME: root, BBK_FIXTURE_STATE: stateFile } };
}

test('actual release wrapper uses guarded full-SHA publication and restores its fake account', async t => {
  for (const dryRun of [true, false]) {
    const f = await wrapperFixture(t);
    const result = await processTools.run('bash', [path.join(f.source, 'scripts/release-fork-vsix.sh'), '--release-issue', 'bbk-release', ...(dryRun ? ['--dry-run'] : [])], { cwd: f.source, env: { ...f.env, GH_HOST: 'fixture.invalid' }, timeout: 30000 });
    assert.equal(result.code, 0, result.stderr);
    const calls = (await readFile(f.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
    assert.ok(calls.filter(call => call.name === 'gh').every(call => call.host === 'github.com'));
    const published = calls.filter(call => call.name === 'gh' && call.args[0] === 'release');
    assert.equal(published.length, dryRun ? 0 : 1);
    if (!dryRun) {
      assert.ok(published[0].args.includes('--latest'));
      assert.equal(published[0].args[published[0].args.indexOf('--target') + 1], 'a'.repeat(40));
    }
    assert.equal(JSON.parse(await readFile(f.stateFile, 'utf8')).account, 'fixture-user');
    assert.equal(calls.filter(call => call.name === 'bd' && call.args.includes('ready')).length, 2);
  }
});

test('actual release wrapper keeps primary failure observable when restoration also fails', async t => {
  const f = await wrapperFixture(t, { buildFailure: true, restoreFailure: true });
  const result = await processTools.run('bash', [path.join(f.source, 'scripts/release-fork-vsix.sh'), '--release-issue', 'bbk-release'], { cwd: f.source, env: f.env, timeout: 30000 });
  assert.equal(result.code, 7);
  assert.match(result.stderr, /restoration failed/);
  const calls = (await readFile(f.log, 'utf8')).trim().split('\n').map(line => JSON.parse(line));
  assert.equal(calls.some(call => call.name === 'vsce' || call.name === 'gh' && call.args[0] === 'release'), false);
});
