import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import childProcess from 'node:child_process';
import { createRequire } from 'node:module';
import { isDeepStrictEqual } from 'node:util';
import { scratch } from './support/fixtures.mjs';

const require = createRequire(import.meta.url);
const identity = { version: '1.3.1', commit: 'fixture-commit', build: 'fixture-build' };
const names = ['events-journal-config-off.json', 'events-journal-config-on.json'];

test('importing the recorder leaves environment, scratch, processes and output untouched', t => {
  const env = { ...process.env };
  const helper = require.resolve('../../scripts/lib/bd-scratch-workspace.js');
  assert.equal(require.cache[helper], undefined);
  const unexpectedEffect = () => { throw new Error('Recorder import must not perform side effects'); };
  const mocks = [
    t.mock.method(childProcess, 'spawnSync', unexpectedEffect),
    ...['mkdtempSync', 'mkdirSync', 'writeFileSync', 'rmSync'].map(name => t.mock.method(fs, name, unexpectedEffect)),
    t.mock.method(console, 'log', unexpectedEffect)
  ];
  assert.equal(typeof require('../../scripts/record-bd-fixtures.js').main, 'function');
  assert.ok(isDeepStrictEqual({ ...process.env }, env), 'Recorder import must preserve the environment');
  assert.equal(require.cache[helper], undefined);
  for (const mock of mocks) assert.equal(mock.mock.callCount(), 0);
});

async function fixture(t, { version = identity, transform = (_args, result) => result } = {}) {
  const root = await scratch(t);
  const fixturesRoot = path.join(root, 'output');
  const dir = path.join(root, 'workspace');
  const outDir = path.join(fixturesRoot, 'bd-1.3.1');
  fs.mkdirSync(dir);
  fs.mkdirSync(outDir, { recursive: true });
  fs.writeFileSync(path.join(outDir, 'version.json'), JSON.stringify(identity));
  fs.writeFileSync(path.join(outDir, 'unrelated.json'), 'sentinel bytes\n');
  const calls = [];
  const logs = [];
  let enabled = false;
  let creates = 0;
  let destroyed = 0;
  let nextId = 0;
  const runtime = {
    BD: '/synthetic/bd',
    SPAWN_DEFAULTS: { encoding: 'utf8', shell: false, timeout: 30000, maxBuffer: 50 * 1024 * 1024 },
    env: { TZ: 'UTC', BEADS_ACTOR: 'fixture-actor' },
    createScratchWorkspace(prefix) {
      assert.equal(prefix, 'fx');
      creates++;
      return { dir, bdArgs: ['-C', dir], destroy() { destroyed++; fs.rmSync(dir, { recursive: true }); } };
    },
    spawnSync(binary, allArgs, options) {
      assert.equal(binary, runtime.BD);
      assert.deepEqual(allArgs.slice(0, 2), ['-C', dir]);
      assert.equal(options.cwd, dir);
      assert.equal(options.shell, false);
      assert.equal(options.encoding, 'utf8');
      assert.equal(options.timeout, 30000);
      assert.equal(options.maxBuffer, 50 * 1024 * 1024);
      assert.equal(options.env.TZ, 'UTC');
      const args = allArgs.slice(2);
      calls.push(args);
      let value = {};
      if (args[0] === 'version') value = version;
      if (args[0] === 'context') value = { dolt_mode: 'embedded' };
      if (args[0] === 'create') return { status: 0, stdout: `fx-${++nextId}\n`, stderr: '' };
      if (args.slice(0, 3).join(' ') === 'config set events-journal') enabled = args[3] === 'true';
      if (args.slice(0, 3).join(' ') === 'config get events-journal') {
        value = { key: 'events-journal', location: `${dir}/config.yaml`, value: String(enabled), extra: { owner: 'synthetic-owner', project_id: 'synthetic-project', workspace: dir, at: '2026-11-01T12:00:00Z' } };
      }
      return transform(args, { status: 0, stdout: JSON.stringify(value), stderr: '' });
    }
  };
  return {
    outDir, calls, logs, runtime,
    run: (argv = ['--events-journal-config-only']) => require('../../scripts/record-bd-fixtures.js').main(argv, { runtime, fixturesRoot, log: line => logs.push(line) }),
    lifecycle: () => ({ creates, destroyed }),
    snapshot: () => Object.fromEntries(fs.readdirSync(outDir).sort().map(name => [name, fs.readFileSync(path.join(outDir, name), 'utf8')]))
  };
}

test('targeted recording writes only both GET captures, preserves sentinels and reports provenance', async t => {
  const f = await fixture(t);
  const before = f.snapshot();
  f.run();
  const after = f.snapshot();
  assert.deepEqual(Object.keys(after).sort(), [...Object.keys(before), ...names].sort());
  for (const [name, bytes] of Object.entries(before)) assert.equal(after[name], bytes);
  for (const [index, name] of names.entries()) {
    assert.deepEqual(JSON.parse(after[name]), {
      key: 'events-journal', location: '<WORKSPACE>/config.yaml', value: String(Boolean(index)),
      extra: { owner: 'fixture-owner@example.com', project_id: '00000000-0000-4000-8000-000000000000', workspace: '<WORKSPACE>', at: '2026-01-02T03:04:05Z' }
    });
  }
  assert.deepEqual(f.calls, [
    ['version', '--json'], ['context', '--json'],
    ['config', 'set', 'events-journal', 'false'], ['config', 'get', 'events-journal', '--json'],
    ['config', 'set', 'events-journal', 'true'], ['config', 'get', 'events-journal', '--json']
  ]);
  assert.deepEqual(f.logs.slice(0, -1), [
    'Recorder executable: /synthetic/bd',
    `bd identity: ${JSON.stringify(identity)}`,
    ...f.calls.map(args => `Captured command: ${JSON.stringify(args)}; exit=0`)
  ]);
  assert.match(f.logs.at(-1), /^Recorded 2 fixtures for bd 1\.3\.1 in /);
  assert.deepEqual(f.lifecycle(), { creates: 1, destroyed: 1 });
});

for (const encoding of ['string', 'boolean']) {
  test(`targeted key/value ${encoding} responses preserve metadata and explicit off/on values`, async t => {
    let enabled = false;
    const f = await fixture(t, { transform(args, result) {
      if (args.slice(0, 3).join(' ') === 'config set events-journal') enabled = args[3] === 'true';
      if (args.slice(0, 3).join(' ') === 'config get events-journal') {
        const { extra } = JSON.parse(result.stdout);
        result.stdout = JSON.stringify({ key: 'events-journal', location: `${extra.workspace}/config.yaml`, value: encoding === 'boolean' ? enabled : String(enabled), extra });
      }
      return result;
    } });
    f.run();
    for (const [index, name] of names.entries()) {
      assert.deepEqual(JSON.parse(f.snapshot()[name]), {
        key: 'events-journal', location: '<WORKSPACE>/config.yaml',
        value: encoding === 'boolean' ? Boolean(index) : String(Boolean(index)),
        extra: { owner: 'fixture-owner@example.com', project_id: '00000000-0000-4000-8000-000000000000', workspace: '<WORKSPACE>', at: '2026-01-02T03:04:05Z' }
      });
    }
  });
}

test('targeted key/value responses do not require location metadata', async t => {
  const f = await fixture(t, { transform(args, result) {
    if (args.slice(0, 3).join(' ') === 'config get events-journal') {
      const payload = JSON.parse(result.stdout);
      delete payload.location;
      result.stdout = JSON.stringify(payload);
    }
    return result;
  } });
  f.run();
  for (const [index, name] of names.entries()) {
    const payload = JSON.parse(f.snapshot()[name]);
    assert.equal(payload.key, 'events-journal');
    assert.equal(payload.value, String(Boolean(index)));
    assert.equal(Object.hasOwn(payload, 'location'), false);
  }
});

test('bad or duplicate recorder flags fail before scratch creation or process execution', async t => {
  for (const argv of [['--unknown'], ['--events-journal-config-only', '--events-journal-config-only'], ['--events-journal-config-only', 'extra'], ['--output', '/synthetic']]) {
    const f = await fixture(t);
    const before = f.snapshot();
    assert.throws(() => f.run(argv), /Expected no arguments or --events-journal-config-only/);
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.calls, []);
    assert.deepEqual(f.lifecycle(), { creates: 0, destroyed: 0 });
  }
});

test('targeted recording requires an existing directory and matching version, commit and build', async t => {
  for (const version of [{ ...identity, version: '1.3.2' }, { ...identity, commit: 'other' }, { ...identity, build: 'other' }, { ...identity, build: undefined }, { ...identity, version: '../escape' }]) {
    const f = await fixture(t, { version });
    const before = f.snapshot();
    assert.throws(() => f.run());
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.calls, [['version', '--json']]);
    assert.deepEqual(f.lifecycle(), { creates: 1, destroyed: 1 });
  }
  const f = await fixture(t);
  fs.rmSync(f.outDir, { recursive: true });
  assert.throws(() => f.run());
  assert.equal(fs.existsSync(f.outDir), false);
  assert.deepEqual(f.lifecycle(), { creates: 1, destroyed: 1 });
});

test('failed or invalid targeted GET captures preserve every output byte, including existing captures', async t => {
  const failures = ['exit', 'terminated', 'malformed', 'null', 'array', 'string', 'number',
    'wrong-key', 'missing-key', 'null-key', 'missing-value', 'null-value', 'number-value',
    'array-value', 'object-value', 'uppercase-value', 'empty-value',
    'opposite-boolean', 'opposite-string', 'old-string', 'old-boolean', 'old-with-key'];
  for (const state of ['false', 'true']) {
    for (const failure of failures) {
      for (const existing of [false, true]) {
        let enabled = 'false';
        const f = await fixture(t, { transform(args, result) {
          if (args.slice(0, 3).join(' ') === 'config set events-journal') enabled = args[3];
          if (args.slice(0, 3).join(' ') === 'config get events-journal' && enabled === state) {
            let payload = { ...JSON.parse(result.stdout), marker: 'SYNTHETIC_PAYLOAD_MARKER' };
            result.stderr = 'SYNTHETIC_STDERR_MARKER';
            switch (failure) {
              case 'exit': result.status = 1; break;
              case 'terminated': result.status = null; break;
              case 'null': payload = null; break;
              case 'array': payload = [payload]; break;
              case 'string': payload = 'SYNTHETIC_PAYLOAD_MARKER'; break;
              case 'number': payload = 1; break;
              case 'wrong-key': payload.key = 'other-config'; break;
              case 'missing-key': delete payload.key; break;
              case 'null-key': payload.key = null; break;
              case 'missing-value': delete payload.value; break;
              case 'null-value': payload.value = null; break;
              case 'number-value': payload.value = 1; break;
              case 'array-value': payload.value = [enabled]; break;
              case 'object-value': payload.value = { enabled }; break;
              case 'uppercase-value': payload.value = enabled.toUpperCase(); break;
              case 'empty-value': payload.value = ''; break;
              case 'opposite-boolean': payload.value = enabled !== 'true'; break;
              case 'opposite-string': payload.value = enabled === 'true' ? 'false' : 'true'; break;
              case 'old-string': payload = { 'events-journal': enabled }; break;
              case 'old-boolean': payload = { 'events-journal': enabled === 'true' }; break;
              case 'old-with-key': payload = { key: 'events-journal', 'events-journal': enabled }; break;
            }
            result.stdout = failure === 'malformed' ? '{SYNTHETIC_PAYLOAD_MARKER' : JSON.stringify(payload);
          }
          return result;
        } });
        if (existing) for (const name of names) fs.writeFileSync(path.join(f.outDir, name), `old ${name}\n`);
        const before = f.snapshot();
        assert.throws(() => f.run(), error => {
          assert.equal(error.message, `Invalid events-journal config-get capture for ${state}`);
          assert.equal(/SYNTHETIC_(PAYLOAD|STDERR)_MARKER/.test(error.message), false);
          return true;
        }, `${state}/${failure}/${existing}`);
        assert.deepEqual(f.snapshot(), before);
        assert.deepEqual(f.lifecycle(), { creates: 1, destroyed: 1 });
        assert.deepEqual(f.logs, []);
      }
    }
  }
});

test('failed targeted SET, version, context and process starts write no fixtures and clean scratch', async t => {
  for (const failure of ['off', 'on', 'version', 'context', 'spawn']) {
    const f = await fixture(t, { transform(args, result) {
      if (failure === 'spawn') return { error: new Error('synthetic private diagnostic') };
      if (args[0] === failure || ['off', 'on'].includes(failure) && args.slice(0, 3).join(' ') === 'config set events-journal' && args[3] === (failure === 'off' ? 'false' : 'true')) {
        if (failure === 'context') result.stdout = '{"dolt_mode":"server"}';
        else result.status = 1;
      }
      return result;
    } });
    const before = f.snapshot();
    assert.throws(() => f.run());
    assert.deepEqual(f.snapshot(), before);
    assert.deepEqual(f.lifecycle(), { creates: 1, destroyed: 1 });
  }
});

test('full recording retains every capture plus both GETs and enables journaling before tail', async t => {
  const expected = [
    'version.json', 'ids.json', 'list-all.json', 'list-brief.json', 'ready.json', 'show-batch.json',
    'show-full.json', 'show-brief-deps.json', 'stats.json', 'comments.json', 'context.json',
    'close-refused-children.json', 'close-refused-blocker.json', 'if-status-mismatch.json',
    'unclaim-not-holder.json', 'max-rows.json', 'events-journal-config.json', ...names,
    'events-tail.jsonl', 'events-prune.json', 'events-tail-truncated.json', 'local-version.json'
  ];
  for (const unsupported of [false, true]) {
    const f = await fixture(t, { transform(args, result) {
      if (args.slice(0, 3).join(' ') === 'config set events-journal') result.stdout = 'SET acknowledged';
      if (unsupported && args.slice(0, 3).join(' ') === 'config get events-journal') return { status: 1, stdout: 'unsupported stdout', stderr: 'unsupported stderr' };
      return result;
    } });
    f.run([]);
    const captures = f.snapshot();
    assert.deepEqual(Object.keys(captures).sort(), expected.sort());
    assert.deepEqual(JSON.parse(captures['events-journal-config.json']), { args: ['config', 'set', 'events-journal', 'true'], exitCode: 0, stdout: 'SET acknowledged', stderr: '' });
    for (const [index, name] of names.entries()) {
      if (unsupported) assert.deepEqual(JSON.parse(captures[name]), { args: ['config', 'get', 'events-journal', '--json'], exitCode: 1, stdout: 'unsupported stdout', stderr: 'unsupported stderr' });
      else {
        const payload = JSON.parse(captures[name]);
        assert.equal(payload.key, 'events-journal');
        assert.equal(payload.value, String(Boolean(index)));
        assert.equal(payload.location, '<WORKSPACE>/config.yaml');
      }
    }
    const journalCalls = f.calls.filter(args => args[0] === 'config' && args[2] === 'events-journal');
    assert.deepEqual(journalCalls, [
      ['config', 'set', 'events-journal', 'false'], ['config', 'get', 'events-journal', '--json'],
      ['config', 'set', 'events-journal', 'true'], ['config', 'get', 'events-journal', '--json']
    ]);
    const tailIndex = f.calls.findIndex(args => args[0] === 'events' && args[1] === 'tail');
    assert.ok(tailIndex > f.calls.findIndex(args => args.join(' ') === 'config set events-journal true'));
    assert.deepEqual(f.lifecycle(), { creates: 1, destroyed: 1 });
  }
});
