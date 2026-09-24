import assert from 'node:assert/strict';
import test from 'node:test';
import { EventEmitter } from 'node:events';
import { Writable } from 'node:stream';
import type { spawn } from 'node:child_process';
import { copyId } from '../src/clipboard';

function fakeSpawn(behavior: 'success' | 'error' | 'timeout' | 'nonzero' | 'stdin' = 'success') {
  const calls: unknown[][] = [];
  const bytes: Buffer[] = [];
  let killed = 0;
  const child = new EventEmitter() as EventEmitter & { stdin: Writable; kill: (signal: string) => boolean };
  child.stdin = new Writable({ write(chunk, _encoding, callback) { bytes.push(Buffer.from(chunk)); callback(behavior === 'stdin' ? new Error('pipe') : undefined); } });
  child.kill = signal => { assert.equal(signal, 'SIGKILL'); killed++; return true; };
  const spawnFake = ((...args: unknown[]) => {
    calls.push(args);
    if (behavior !== 'timeout' && behavior !== 'stdin') {
      queueMicrotask(() => behavior === 'error' ? child.emit('error', new Error('ENOENT')) : child.emit('close', behavior === 'success' ? 0 : 1));
    }
    return child;
  }) as unknown as typeof spawn;
  return { spawn: spawnFake, calls, bytes, child, killed: () => killed };
}

test('macOS built-in pbcopy receives exact ID bytes on stdin with no shell', async () => {
  const fake = fakeSpawn();
  assert.equal(await copyId('project.x-123.4', 'auto', { platform: 'darwin', spawn: fake.spawn }), 'Copied project.x-123.4');
  assert.deepEqual(fake.calls, [['/usr/bin/pbcopy', [], { shell: false, stdio: ['pipe', 'ignore', 'ignore'] }]]);
  assert.equal(Buffer.concat(fake.bytes).toString(), 'project.x-123.4');
  assert.equal(fake.killed(), 0);
});

test('OSC 52 is explicit and reports a request, manual and Linux auto have no effects', async () => {
  const writes: string[] = [];
  const fake = fakeSpawn();
  const options = { platform: 'linux' as const, spawn: fake.spawn, write: (text: string) => writes.push(text) };
  assert.equal(await copyId('x-abc', 'auto', options), 'Copy manually: x-abc');
  assert.equal(await copyId('x-abc', 'manual', { ...options, platform: 'darwin' }), 'Copy manually: x-abc');
  assert.deepEqual(writes, []);
  assert.deepEqual(fake.calls, []);
  assert.equal(await copyId('x-abc', 'osc52', options), 'OSC 52 clipboard request sent');
  assert.deepEqual(writes, ['\x1b]52;c;eC1hYmM=\x07']);
  assert.deepEqual(fake.calls, []);
});

test('invalid IDs cannot spawn a clipboard process or emit an OSC sequence', async () => {
  const fake = fakeSpawn();
  const writes: string[] = [];
  for (const id of ['-x-a', 'x-a\n', 'x-a;pwd', 'x-a\x1b]52;c;evil\x07', 'x-a\u202e']) {
    for (const mode of ['auto', 'osc52', 'manual'] as const) {
      assert.equal(await copyId(id, mode, { platform: 'darwin', spawn: fake.spawn, write: text => writes.push(text) }), 'Cannot copy: invalid issue ID');
    }
  }
  assert.deepEqual(writes, []);
  assert.deepEqual(fake.calls, []);
});

test('clipboard failures and bounded timeout settle with manual feedback and cleanup', async () => {
  for (const behavior of ['error', 'timeout', 'nonzero', 'stdin'] as const) {
    const fake = fakeSpawn(behavior);
    assert.match(await copyId('x-abc', 'auto', { platform: 'darwin', spawn: fake.spawn, timeoutMs: 10 }), /copy manually: x-abc/u);
    if (behavior !== 'nonzero') { assert.equal(fake.killed(), 1); assert.equal(fake.child.stdin.destroyed, true); }
    fake.child.emit('error', new Error('late'));
  }
  const message = await copyId('x-abc', 'osc52', { write: () => { throw new Error('\x1b[2Jbroken'); } });
  assert.equal(message, 'Clipboard request failed: broken');
});

test('cancellation kills an owned clipboard process and prevents subsequent effects', async () => {
  const fake = fakeSpawn('timeout');
  const lifetime = new AbortController();
  const pending = copyId('x-abc', 'auto', { platform: 'darwin', spawn: fake.spawn, signal: lifetime.signal });
  lifetime.abort();
  assert.equal(await pending, 'Clipboard cancelled; copy manually: x-abc');
  assert.equal(fake.killed(), 1);
  assert.equal(fake.child.stdin.destroyed, true);
  const writes: string[] = [];
  await copyId('x-abc', 'osc52', { signal: lifetime.signal, write: text => writes.push(text) });
  assert.deepEqual(writes, []);
});
