import assert from 'node:assert/strict';
import { test } from 'node:test';
import { resolve } from 'node:path';
import { parseOptions } from '../src/options';

test('defaults and explicit launch options resolve against launch cwd', () => {
  assert.deepEqual(parseOptions([], '/tmp'), {
    repo: resolve('/tmp'), bdPath: 'bd', limit: 1000, clipboard: 'auto', help: false
  });
  assert.deepEqual(parseOptions(['--repo', 'repo', '--bd-path', './bin/bd', '--limit', '5000', '--clipboard', 'osc52', '--help'], '/tmp'), {
    repo: resolve('/tmp/repo'), bdPath: resolve('/tmp/bin/bd'), limit: 5000, clipboard: 'osc52', help: true
  });
  assert.equal(parseOptions(['--limit', '1', '--clipboard', 'manual']).limit, 1);
});

test('rejects unknown, duplicate, missing, invalid and terminal-control options', () => {
  for (const args of [
    ['--unknown'], ['--repo'], ['--repo', '--help'], ['--help', '--help'], ['--limit', '1', '--limit', '2'],
    ['--limit', '0'], ['--limit', '5001'], ['--limit', '1.1'], ['--limit', '1e3'], ['--limit', '-1'],
    ['--clipboard', 'pbcopy'], ['--repo', '\x1b]52;evil'], ['--bd-path', 'bd\n'], ['--repo=foo'], ['--repo', '']
  ]) { assert.throws(() => parseOptions(args)); }
  assert.throws(() => parseOptions([], '/tmp/\x9bpath'));
});
