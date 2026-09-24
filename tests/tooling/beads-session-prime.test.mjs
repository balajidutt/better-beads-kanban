import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, realpath } from 'node:fs/promises';
import path from 'node:path';
import { scratch } from './support/fixtures.mjs';
import priming from '../../scripts/beads-session-prime.js';

test('main, nested and external worktrees prime only the shared main with unchanged stdin', async t => {
  const root = await scratch(t);
  const main = path.join(root, 'main with spaces');
  await mkdir(path.join(main, '.git'), { recursive: true });
  const common = await realpath(path.join(main, '.git'));
  for (const cwd of [main, path.join(main, 'worktrees/nested'), path.join(root, 'external')]) {
    const calls = [];
    const input = JSON.stringify({ cwd, session_id: 'synthetic' });
    const expected = '{"hookSpecificOutput":{"hookEventName":"SessionStart","additionalContext":"fixture"}}\n';
    const execute = async (command, args, options) => {
      calls.push({ command, args, options });
      if (command === 'git') return { code: 0, stdout: common, stderr: '' };
      assert.equal(command, process.platform === 'win32' ? 'bd.exe' : 'bd');
      if (args.includes('context')) return { code: 0, stdout: JSON.stringify({ beads_dir: path.join(path.dirname(common), '.beads') }), stderr: '' };
      assert.deepEqual(args, ['-C', path.dirname(common), '--readonly', 'prime', '--hook-json']);
      assert.equal(options.input, input);
      return { code: 0, stdout: expected, stderr: '' };
    };
    const result = await priming.prime(input, { cwd, toolingRoot: main, execute });
    assert.equal(result.stdout, expected);
    assert.equal(result.code, 0);
    assert.equal(calls.filter(call => call.command !== 'git').length, 2);
  }
});

test('foreign repository and missing CLI fail without priming another backlog', async t => {
  const root = await scratch(t);
  for (const name of ['one', 'two']) await mkdir(path.join(root, name, '.git'), { recursive: true });
  const one = await realpath(path.join(root, 'one/.git'));
  const two = await realpath(path.join(root, 'two/.git'));
  let invokedBd = false;
  const execute = async (command, _args, { cwd }) => {
    if (command !== 'git') { invokedBd = true; throw new Error('SYNTHETIC_PRIVATE'); }
    return { code: 0, stdout: cwd.includes('two') ? two : one, stderr: '' };
  };
  await assert.rejects(priming.prime(JSON.stringify({ cwd: path.dirname(two) }), { toolingRoot: path.dirname(one), execute }), { code: 'FOREIGN_HOOK_REPOSITORY' });
  assert.equal(invokedBd, false);
  const failed = await priming.prime('{}', { cwd: path.dirname(one), toolingRoot: path.dirname(one), execute: async (command, args, options) => command === 'git' ? execute(command, args, options) : args.includes('context') ? { code: 0, stdout: JSON.stringify({ beads_dir: path.join(path.dirname(one), '.beads') }), stderr: '' } : { code: 3, stdout: '', stderr: 'SYNTHETIC_PRIVATE' } });
  assert.equal(failed.code, 3);
  assert.equal(failed.stderr.includes('SYNTHETIC_PRIVATE'), false);
});
