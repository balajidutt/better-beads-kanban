import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, symlink } from 'node:fs/promises';
import { execFileSync, spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { applyBashPermissions, bashRules } from '../../.opencode/permissions/generate.mjs';
import { blocks, roles } from '../../.opencode/permissions/spec.mjs';

const configUrl = new URL('../../.opencode/opencode.jsonc', import.meta.url);
const generator = fileURLToPath(new URL('../../.opencode/permissions/generate.mjs', import.meta.url));

test('opencode.jsonc bash maps match a fresh generation from the spec', async () => {
  const text = await readFile(configUrl, 'utf8');
  assert.equal(applyBashPermissions(text), text, 'run node .opencode/permissions/generate.mjs after editing .opencode/permissions/spec.mjs');
});

test('regeneration restores hand-edited bash maps and leaves other permissions alone', async () => {
  const text = await readFile(configUrl, 'utf8');
  const buildBash = text.indexOf('"bash": "deny"', text.indexOf('\n    "build": {'));
  const tampered = (text.slice(0, buildBash) + '"bash": "allow"' + text.slice(buildBash + '"bash": "deny"'.length))
    .replace('          "git * push *": "deny",\n', '')
    .replace('"bash": {\n          "*": "ask",', '"bash": {\n          "*": "allow",');
  assert.notEqual(tampered, text);
  assert.equal(JSON.parse(tampered).agent.build.permission.bash, 'allow');
  assert.equal(applyBashPermissions(tampered), text);
});

test('an agent key the generator cannot locate fails instead of rewriting another bash value', async () => {
  const text = await readFile(configUrl, 'utf8');
  const respaced = text.replace('\n    "plan-reviewer": {', '\n    "plan-reviewer" : {');
  assert.notEqual(respaced, text);
  assert.throws(() => applyBashPermissions(respaced), /agent plan-reviewer not found/);
});

test('the command line checks through a symlinked path and rejects unknown arguments', async t => {
  const dir = await mkdtemp(path.join(tmpdir(), 'opencode-permissions-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const link = path.join(dir, 'generate.mjs');
  await symlink(generator, link);
  assert.match(execFileSync(process.execPath, [link, '--check'], { encoding: 'utf8' }), /match the spec/);
  const typo = spawnSync(process.execPath, [generator, '--chek'], { encoding: 'utf8' });
  assert.equal(typo.status, 2);
  assert.match(typo.stderr, /unknown argument --chek/);
});

test('every agent with bash rules has a spec entry and every spec entry names a configured agent', async () => {
  const settings = JSON.parse(await readFile(configUrl, 'utf8'));
  const withBash = Object.keys(settings.agent).filter(name => settings.agent[name].permission?.bash !== undefined).sort();
  assert.deepEqual(Object.keys(roles).sort(), withBash);
});

test('the spec rejects a duplicate rule instead of silently keeping the first position', () => {
  const role = { fallback: 'ask', rules: [['git status', 'allow']], denyBlocks: [['git status']], afterDeny: [], afterRedirect: [] };
  assert.throws(() => bashRules(role), /duplicate bash rule "git status"/);
});

test('git denies expand four ways, and the common block applies to every role with a rule map', () => {
  for (const spelling of ['git push *', 'git * push *', 'command git push *', 'command git * push *']) assert.ok(blocks.common.includes(spelling), spelling);
  for (const [name, role] of Object.entries(roles)) {
    if (typeof role === 'string') continue;
    assert.ok(role.denyBlocks.includes(blocks.common), name);
  }
  for (const name of ['plan', 'release-manager']) assert.ok(roles[name].denyBlocks.includes(blocks.readOnlyGit), name);
  for (const spelling of ['git * --output*', 'git * --no-index*']) assert.ok(blocks.readOnlyGit.includes(spelling) && blocks.review.includes(spelling), spelling);
});
