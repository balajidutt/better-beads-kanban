import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readme = await readFile(new URL('../../README.md', import.meta.url), 'utf8');
const pkg = JSON.parse(await readFile(new URL('../../package.json', import.meta.url), 'utf8'));

test('the README VS Code badge names the minimum in engines.vscode', () => {
  const badges = [...readme.matchAll(/img\.shields\.io\/badge\/VS%20Code-(\d+\.\d+)\+-/g)];
  assert.equal(badges.length, 1);
  const engine = /^\^(\d+\.\d+)\.\d+$/.exec(pkg.engines.vscode);
  assert.ok(engine, pkg.engines.vscode);
  assert.equal(badges[0][1], engine[1]);
});

test('the README license badge names the package license', () => {
  const badges = [...readme.matchAll(/img\.shields\.io\/badge\/license-([^-]+)-/g)];
  assert.equal(badges.length, 1);
  assert.equal(badges[0][1], pkg.license);
});
