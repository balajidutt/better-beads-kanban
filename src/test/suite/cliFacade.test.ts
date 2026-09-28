import * as assert from 'assert';
import cp from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as sinon from 'sinon';
import type * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';

suite('CLI facade characterization', () => {
  let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: sinon.SinonSpy };
  let spawn: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;
  let setTimer: sinon.SinonSpy;
  let clearTimer: sinon.SinonSpy;
  let logs: string[];
  let adapter: any;
  let executable: string;

  const adapterTimers = () => setTimer.getCalls()
    .filter(call => (call as unknown as { stack: string }).stack.includes('bdCli'))
    .map(call => call.returnValue);
  const assertAdapterTimersCleared = (count: number) => {
    const timers = adapterTimers();
    assert.strictEqual(timers.length, count);
    for (const timer of timers) { assert.ok(clearTimer.calledWith(timer)); }
  };

  setup(() => {
    clock = sinon.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
    setTimer = sinon.spy(globalThis, 'setTimeout');
    clearTimer = sinon.spy(globalThis, 'clearTimeout');
    child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: sinon.spy()
    });
    spawn = sinon.stub(cp, 'spawn').returns(child as any);
    logs = [];
    executable = '/tools/bd';
    adapter = new DaemonBeadsAdapter('/repo', { appendLine: (line: string) => logs.push(line) } as unknown as vscode.OutputChannel);
    sinon.stub(adapter, 'getBdCommand').callsFake(() => executable);
  });

  teardown(() => { sinon.restore(); clock.restore(); });

  test('resolves executable and repository at each operation and preserves literal argv', async () => {
    const first = adapter.execBd(['show', '--json', 'test-a\0']);
    child.stdout.write('[{"id":"test-a"}]');
    child.emit('close', 0);
    assert.deepStrictEqual(await first, [{ id: 'test-a' }]);
    assert.deepStrictEqual(spawn.firstCall.args, ['/tools/bd', ['show', '--json', 'test-a'], { cwd: '/repo', shell: false }]);
    executable = '/tools/other bd';
    adapter.setWorkspaceRoot('/other');
    const second = adapter.execBd(['comments', 'add', 'test-a', '--', 'literal\n$(date)']);
    child.emit('close', 0);
    await second;
    assert.deepStrictEqual(spawn.secondCall.args, ['/tools/other bd', ['comments', 'add', 'test-a', '--', 'literal\n$(date)'], { cwd: '/other', shell: false }]);
    assertAdapterTimersCleared(2);
  });

  test('titles with multi-byte characters split across output chunks reach the board intact', async () => {
    const operation = adapter.execBd(['list', '--json']);
    const bytes = Buffer.from(JSON.stringify([{ id: 'test-a', title: 'Café 😀 日本' }]));
    const insideEmoji = bytes.indexOf(0xf0) + 3;
    child.stdout.emit('data', bytes.subarray(0, insideEmoji));
    child.stdout.emit('data', bytes.subarray(insideEmoji));
    child.emit('close', 0);
    assert.deepStrictEqual(await operation, [{ id: 'test-a', title: 'Café 😀 日本' }]);
  });

  test('empty and friendly success output resolve null', async () => {
    const empty = adapter.execBd([]);
    child.emit('close', 0);
    assert.strictEqual(await empty, null);
    const friendly = adapter.execBd([]);
    child.stdout.write('Created issue');
    child.emit('close', 0);
    assert.strictEqual(await friendly, null);
    assert.ok(logs.includes('[DaemonBeadsAdapter] Non-JSON output: Created issue'));
  });

  test('command errors scrub paths while spawn errors retain identity', async () => {
    const failed = adapter.execBd(['list']);
    child.stderr.write('failed /Users/private/backlog.db');
    child.emit('close', 2);
    await assert.rejects(failed, { message: 'bd command failed with exit code 2: failed [PATH]' });
    const missing = adapter.execBd(['list']);
    const error = new Error('spawn bd ENOENT');
    child.emit('error', error);
    await assert.rejects(missing, (actual: unknown) => actual === error);
    assertAdapterTimersCleared(2);
  });

  test('default timeout rejects once, sends SIGTERM and leaves no timer', async () => {
    const operation = adapter.execBd(['list']);
    const rejected = assert.rejects(operation, { message: 'Command timed out after 30000ms: /tools/bd list' });
    await clock.tickAsync(30000);
    await rejected;
    assert.deepStrictEqual(child.kill.firstCall.args, ['SIGTERM']);
    child.emit('close', 0);
    assert.strictEqual(child.kill.callCount, 1);
    assert.strictEqual(adapterTimers().length, 1);
  });

  for (const stream of ['stdout', 'stderr'] as const) {
    test(`${stream} enforces the existing 50-MB limit`, async () => {
      const operation = adapter.execBd(['list']);
      const rejected = assert.rejects(operation, { message: stream === 'stdout'
        ? 'Command output exceeded 52428800 bytes limit'
        : 'Command error output exceeded 52428800 bytes limit' });
      child[stream].emit('data', 'x'.repeat(50 * 1024 * 1024 + 1));
      await rejected;
      assert.deepStrictEqual(child.kill.firstCall.args, ['SIGTERM']);
      assertAdapterTimersCleared(1);
    });
  }
});
