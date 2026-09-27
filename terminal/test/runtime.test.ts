import assert from 'node:assert/strict';
import { test } from 'node:test';
import { existsSync, mkdtempSync, mkdirSync, writeFileSync, readFileSync, rmSync, realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createReadService } from '../src/runtime';
import { parseOptions } from '../src/options';

function fixture() {
  const root = realpathSync(mkdtempSync(join(tmpdir(), 'terminal-reader-')));
  const repo = join(root, 'repo');
  mkdirSync(join(repo, '.beads'), { recursive: true });
  writeFileSync(join(repo, '.beads', 'metadata.json'), 'not parsed');
  const executable = join(root, 'bd');
  const response = join(root, 'responses.json');
  const audit = join(root, 'audit.jsonl');
  const base = {
    version: { version: '1.2.2' },
    context: { beads_dir: join(repo, '.beads'), repo_root: repo, cwd_repo_root: repo, database: '/remote/other/database' },
    list: [{ id: 'test-abc', title: 'Title', status: 'custom-status', issue_type: 'custom-type', labels: ['one'] }],
    show: [{ id: 'test-abc', title: 'Title', labels: [{ label: 'one' }], comments: [{ id: '1', text: 'Hi' }] }],
    slow: false
  };
  writeFileSync(response, JSON.stringify(base));
  writeFileSync(executable, `#!${process.execPath}
const fs = require('node:fs');
const args = process.argv.slice(2);
fs.appendFileSync(${JSON.stringify(audit)}, JSON.stringify({ args, cwd: process.cwd(), pid: process.pid }) + '\\n');
const data = JSON.parse(fs.readFileSync(${JSON.stringify(response)}, 'utf8'));
if (data.invalidJson) {
  process.stdout.write('not JSON');
} else if (data.failure) {
  process.stderr.write('unknown flag: --readonly');
  process.exitCode = 1;
} else if (data.slow) {
  process.on('SIGTERM', () => {});
  setInterval(() => {}, 1000);
} else {
  process.stdout.write(JSON.stringify(data[args[0]]));
}
`, { mode: 0o755 });
  return {
    repo, root, base, options: parseOptions(['--repo', repo, '--bd-path', executable, '--limit', '2']),
    set: (data: unknown) => writeFileSync(response, JSON.stringify(data)),
    audit: () => existsSync(audit) ? readFileSync(audit, 'utf8').trim().split('\n').map(line => JSON.parse(line)) : [],
    cleanup: () => rmSync(root, { recursive: true, force: true })
  };
}

test('resolves ancestors, verifies routing, and permits only bounded reads with safety flags', async () => {
  const f = fixture();
  try {
    mkdirSync(join(f.repo, 'nested'));
    const result = await createReadService({ ...f.options, repo: join(f.repo, 'nested') });
    assert.equal(result.repo, f.repo);
    assert.equal(result.version, '1.2.2');
    assert.equal(f.audit().length, 2);
    const cards = await result.service.list(3);
    assert.equal(cards[0].status, 'custom-status');
    assert.equal(cards[0].issue_type, 'custom-type');
    assert.deepEqual((await result.service.detail('test-abc')).labels, ['one']);
    await assert.rejects(result.service.list(4));
    await assert.rejects(result.service.detail('--help'));
    assert.deepEqual(f.audit().map(entry => entry.args), [
      ['version', '--json'],
      ['context', '--json', '--readonly', '--sandbox', '--dolt-auto-commit', 'off'],
      ['list', '--json', '--all', '--limit', '3', '--readonly', '--sandbox', '--dolt-auto-commit', 'off'],
      ['show', '--json', 'test-abc', '--readonly', '--sandbox', '--dolt-auto-commit', 'off']
    ]);
    assert.ok(f.audit().every(entry => entry.cwd === f.repo));
    result.service.dispose();
    await assert.rejects(result.service.list(1), { name: 'AbortError' });
    assert.equal(f.audit().length, 4);
  } finally { f.cleanup(); }
});

test('rejects missing markers, files, routing overrides and invalid startup envelopes', async () => {
  const f = fixture();
  try {
    await assert.rejects(createReadService({ ...f.options, repo: join(f.repo, '.beads', 'metadata.json') }), /directory/);
    await assert.rejects(createReadService({ ...f.options, repo: f.root }), /main-checkout/);
    for (const field of ['beads_dir', 'repo_root', 'cwd_repo_root']) {
      f.set({ ...f.base, context: { ...f.base.context, [field]: f.root } });
      await assert.rejects(createReadService(f.options), /does not match/);
    }
    f.set({ ...f.base, version: '1.2.2' });
    await assert.rejects(createReadService(f.options), /version JSON/);
  } finally { f.cleanup(); }
});

test('rejects hostile optional fields and mismatched show IDs before mapping', async () => {
  const f = fixture();
  try {
    const { service } = await createReadService(f.options);
    for (const field of [
      { id: '--help' }, { title: {} }, { status: [] }, { labels: [null] }, { dependencies: [null] },
      { dependencies: [{ depends_on_id: '--help' }] }, { priority: 'high' }, { comments: [null] }, { metadata: [] }
    ]) {
      f.set({ ...f.base, list: [{ ...f.base.list[0], ...field }] });
      await assert.rejects(service.list(1));
    }
    f.set({ ...f.base, show: [{ id: 'test-other' }] });
    await assert.rejects(service.detail('test-abc'), /selected issue/);
    f.set({ ...f.base, show: [{ id: 'test-abc', labels: [null] }] });
    await assert.rejects(service.detail('test-abc'), /Invalid bd/);
    service.dispose();
  } finally { f.cleanup(); }
});

test('dispose aborts an owned child, escalates, and never delivers a late result', async () => {
  const f = fixture();
  try {
    const { service } = await createReadService(f.options);
    f.set({ ...f.base, slow: true });
    const pending = service.list(1);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    for (let i = 0; i < 100 && f.audit().length < 3; i++) { await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(f.audit().length, 3);
    await new Promise(resolve => setTimeout(resolve, 30));
    const pid = f.audit()[2].pid;
    service.dispose();
    await rejected;
    await new Promise(resolve => setTimeout(resolve, 500));
    assert.throws(() => process.kill(pid, 0));
    service.dispose();
  } finally { f.cleanup(); }
});

test('pre-aborted startup never launches bd', async () => {
  const f = fixture();
  try {
    const abort = new AbortController();
    abort.abort();
    await assert.rejects(createReadService(f.options, abort.signal), { name: 'AbortError' });
    assert.equal(f.audit().length, 0);
  } finally { f.cleanup(); }
});

test('invalid JSON and rejected safety flags fail without a fallback command', async () => {
  const f = fixture();
  try {
    const { service } = await createReadService(f.options);
    f.set({ ...f.base, invalidJson: true });
    await assert.rejects(service.list(1), /invalid JSON/);
    f.set({ ...f.base, failure: true });
    await assert.rejects(service.list(1), /unknown flag/);
    assert.equal(f.audit().length, 4);
    service.dispose();
  } finally { f.cleanup(); }
});

test('startup signal cancels an in-flight probe and prevents service creation', async () => {
  const f = fixture();
  try {
    f.set({ ...f.base, slow: true });
    const abort = new AbortController();
    const pending = createReadService(f.options, abort.signal);
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    for (let i = 0; i < 200 && f.audit().length < 1; i++) { await new Promise(resolve => setTimeout(resolve, 10)); }
    assert.equal(f.audit().length, 1);
    await new Promise(resolve => setTimeout(resolve, 30));
    abort.abort();
    await rejected;
    await new Promise(resolve => setTimeout(resolve, 500));
    const entries = f.audit();
    assert.equal(entries.length, 1);
    assert.throws(() => process.kill(entries[0].pid, 0));
  } finally { f.cleanup(); }
});
