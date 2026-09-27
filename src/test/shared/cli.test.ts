import * as assert from 'assert';
import cp from 'child_process';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as sinon from 'sinon';
import { executeBd, sanitizeCliArg } from '../../shared/node';

suite('Shared CLI runner', () => {
  let child: EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: sinon.SinonSpy };
  let spawn: sinon.SinonStub;
  let clock: sinon.SinonFakeTimers;
  const options = { executable: 'bd', cwd: '/repo' };

  setup(() => {
    clock = sinon.useFakeTimers();
    child = Object.assign(new EventEmitter(), {
      stdout: new PassThrough(), stderr: new PassThrough(), kill: sinon.spy()
    });
    spawn = sinon.stub(cp, 'spawn').returns(child as any);
  });
  teardown(() => { sinon.restore(); clock.restore(); });

  test('passes literal arguments with no shell and decodes JSON', async () => {
    const operation = executeBd(['list', '--json', 'literal\0\n$(date)'], options);
    child.stdout.write(' [1, "two"] \n');
    child.emit('close', 0);
    assert.deepStrictEqual(await operation, [1, 'two']);
    assert.deepStrictEqual(spawn.firstCall.args, ['bd', ['list', '--json', 'literal\n$(date)'], { cwd: '/repo', shell: false }]);
    assert.strictEqual(clock.countTimers(), 0);
    assert.strictEqual(sanitizeCliArg(5 as any), '5');
  });

  test('pre-aborted signal does not spawn', async () => {
    const controller = new AbortController();
    controller.abort();
    await assert.rejects(executeBd(['list'], { ...options, signal: controller.signal }), { name: 'AbortError' });
    assert.strictEqual(spawn.callCount, 0);
  });

  test('cancellation escalates only when opted in and clears its timer on close', async () => {
    Object.assign(child, { exitCode: null, signalCode: null });
    const controller = new AbortController();
    const pending = executeBd(['list'], { ...options, signal: controller.signal, killGraceMs: 25 });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    controller.abort();
    await rejected;
    assert.deepStrictEqual(child.kill.firstCall.args, ['SIGTERM']);
    await clock.tickAsync(25);
    assert.deepStrictEqual(child.kill.secondCall.args, ['SIGKILL']);
    child.stdout.write('[]');
    child.emit('close', null);
    assert.strictEqual(clock.countTimers(), 0);
  });

  test('close before grace prevents SIGKILL', async () => {
    Object.assign(child, { exitCode: null, signalCode: null });
    const controller = new AbortController();
    const pending = executeBd(['list'], { ...options, signal: controller.signal, killGraceMs: 25 });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    controller.abort();
    child.emit('close', null);
    await rejected;
    await clock.tickAsync(30);
    assert.strictEqual(child.kill.callCount, 1);
    assert.strictEqual(clock.countTimers(), 0);
  });

  test('abort after success is inert', async () => {
    const controller = new AbortController();
    const pending = executeBd(['list'], { ...options, signal: controller.signal, killGraceMs: 25 });
    child.stdout.write('[]');
    child.emit('close', 0);
    await pending;
    controller.abort();
    assert.strictEqual(child.kill.callCount, 0);
    assert.strictEqual(clock.countTimers(), 0);
  });

  test('cancellation without escalation retains SIGTERM-only behavior', async () => {
    Object.assign(child, { exitCode: null, signalCode: null });
    const controller = new AbortController();
    const pending = executeBd(['list'], { ...options, signal: controller.signal });
    const rejected = assert.rejects(pending, { name: 'AbortError' });
    controller.abort();
    await rejected;
    await clock.tickAsync(6000);
    assert.deepStrictEqual(child.kill.args, [['SIGTERM']]);
    child.emit('close', null);
    assert.strictEqual(clock.countTimers(), 0);
  });

  test('timeout escalation is bounded and preserves the timeout error', async () => {
    Object.assign(child, { exitCode: null, signalCode: null });
    const pending = executeBd(['list'], { ...options, timeoutMs: 10, killGraceMs: Infinity });
    const rejected = assert.rejects(pending, { message: 'Command timed out after 10ms: bd list' });
    await clock.tickAsync(10);
    await rejected;
    await clock.tickAsync(5000);
    assert.deepStrictEqual(child.kill.args, [['SIGTERM'], ['SIGKILL']]);
    child.emit('close', null);
    assert.strictEqual(clock.countTimers(), 0);
  });

  for (const output of ['', 'Created issue', '{not-json', 'warning\n[]']) {
    test(`strict decoding rejects ${JSON.stringify(output)} without exposing output`, async () => {
      const operation = executeBd(['list'], { ...options, jsonPolicy: 'strict' });
      child.stdout.write(output);
      child.emit('close', 0);
      await assert.rejects(operation, { message: 'bd returned invalid JSON output' });
      assert.strictEqual(clock.countTimers(), 0);
    });
  }

  test('compatibility policy accepts non-JSON success', async () => {
    const logs: string[] = [];
    const operation = executeBd(['create'], { ...options, log: line => logs.push(line) });
    child.stdout.write('Created issue');
    child.emit('close', 0);
    assert.strictEqual(await operation, null);
    assert.deepStrictEqual(logs, ['Non-JSON output: Created issue']);
  });

  test('spawn failure retains identity and clears timeout', async () => {
    const operation = executeBd(['list'], options);
    const error = new Error('spawn bd ENOENT');
    child.emit('error', error);
    child.emit('close', -2);
    await assert.rejects(operation, value => value === error);
    assert.strictEqual(clock.countTimers(), 0);
    assert.strictEqual(child.kill.callCount, 0);
  });

  test('nonzero and signal exits reject with sanitized output', async () => {
    const operation = executeBd(['list'], options);
    child.stdout.write('failed /Users/private/issues.json');
    child.emit('close', null);
    await assert.rejects(operation, { message: 'bd command failed with exit code null: failed [PATH]' });
    assert.strictEqual(clock.countTimers(), 0);
  });

  test('custom timeout settles only once and ignores subsequent events', async () => {
    const logs: string[] = [];
    const operation = executeBd(['list'], { ...options, timeoutMs: 10, log: line => logs.push(line) });
    const rejected = assert.rejects(operation, { message: 'Command timed out after 10ms: bd list' });
    await clock.tickAsync(10);
    await rejected;
    child.stdout.write('[]');
    child.emit('error', new Error('late'));
    child.emit('close', 0);
    assert.deepStrictEqual(logs, ['Command timed out after 10ms: bd list']);
    assert.deepStrictEqual(child.kill.firstCall.args, ['SIGTERM']);
    assert.strictEqual(clock.countTimers(), 0);
  });

  for (const stream of ['stdout', 'stderr'] as const) {
    test(`${stream} overflow kills the process and clears timeout`, async () => {
      const operation = executeBd(['list'], options);
      const rejected = assert.rejects(operation, { message: stream === 'stdout'
        ? 'Command output exceeded 52428800 bytes limit'
        : 'Command error output exceeded 52428800 bytes limit' });
      child[stream].emit('data', 'x'.repeat(50 * 1024 * 1024 + 1));
      await rejected;
      child[stream].emit('data', 'late');
      child.emit('close', 0);
      assert.strictEqual(child.kill.callCount, 1);
      assert.strictEqual(clock.countTimers(), 0);
    });
  }
});

suite('Shared CLI real subprocess', () => {
  test('executes a binary directly and decodes its response', async () => {
    const result = await executeBd(['-e', 'process.stdout.write(JSON.stringify({cwd:process.cwd(),arg:process.argv[1]}))', 'a b;$HOME'], {
      executable: process.execPath, cwd: process.cwd(), timeoutMs: 5000, jsonPolicy: 'strict'
    });
    assert.deepStrictEqual(result, { cwd: process.cwd(), arg: 'a b;$HOME' });
  });
});
