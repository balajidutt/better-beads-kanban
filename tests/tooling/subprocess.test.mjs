import test from 'node:test';
import assert from 'node:assert/strict';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scratch } from './support/fixtures.mjs';
import processTools from '../../scripts/lib/workflow-process.js';

const { run, gitEnvironment } = processTools;

test('subprocess bounds reject excessive output and do not expose stderr', async t => {
  const root = await scratch(t);
  const script = path.join(root, 'output.cjs');
  await writeFile(script, "process.stderr.write('SYNTHETIC_PRIVATE'.repeat(1000));");
  await assert.rejects(run(process.execPath, [script], { cwd: root, maxBytes: 128 }), error => error.code === 'PROCESS_OUTPUT_LIMIT' && !error.message.includes('SYNTHETIC_PRIVATE'));
});

test('subprocess timeout and cancellation terminate only the owned child', async t => {
  const root = await scratch(t);
  const script = path.join(root, 'wait.cjs');
  await writeFile(script, 'setInterval(() => {}, 1000);');
  await assert.rejects(run(process.execPath, [script], { cwd: root, timeout: 50 }), { code: 'PROCESS_TIMEOUT' });
  const controller = new AbortController();
  const pending = run(process.execPath, [script], { cwd: root, signal: controller.signal });
  controller.abort();
  await assert.rejects(pending, { code: 'PROCESS_CANCELLED' });
});

test('subprocess preserves stdin and exit status without shell interpretation', async t => {
  const root = await scratch(t);
  const script = path.join(root, 'input.cjs');
  await writeFile(script, 'process.stdin.pipe(process.stdout); process.exitCode = 7;');
  const result = await run(process.execPath, [script], { cwd: root, input: '$(not-a-command)\n' });
  assert.equal(result.stdout, '$(not-a-command)\n');
  assert.equal(result.code, 7);
  assert.deepEqual(gitEnvironment({ PATH: 'synthetic', GIT_DIR: '/foreign', GIT_CONFIG_COUNT: '1' }), { PATH: 'synthetic', GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' });
});

test('subprocess without input connects the child stdin to the null device, not a pipe', async t => {
  const root = await scratch(t);
  const script = path.join(root, 'stdin.cjs');
  await writeFile(script, "const fs = require('fs'); process.stdout.write(`${fs.fstatSync(0).isCharacterDevice()}:${fs.readFileSync(0).length}`);");
  const result = await run(process.execPath, [script], { cwd: root });
  assert.equal(result.stdout, 'true:0');
  assert.equal(result.code, 0);
});
