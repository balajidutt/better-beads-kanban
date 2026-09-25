import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { scratch, eventually } from './support/fixtures.mjs';
import { createRuntime, reviewDecision, reviewRequest } from '../../.opencode/lib/review-loop.js';
import Marker from '../../.opencode/plugins/review-loop-marker.js';
import Enforcer from '../../.opencode/plugins/review-loop-enforcer.js';
import Gate from '../../.opencode/plugins/review-loop-gate.js';

const sourceConfig = JSON.parse(await readFile(new URL('../../.opencode/opencode-tooling.config.jsonc', import.meta.url), 'utf8'));
const config = { ...sourceConfig, debounceMs: 1 };
const prefix = config.resultMarkerPrefix;
const idle = sid => ({ event: { type: 'session.idle', properties: { sessionID: sid } } });
const user = (sid, agent = 'build') => ({ event: { type: 'message.updated', properties: { info: { sessionID: sid, role: 'user', agent } } } });

async function fixture(t, options = {}) {
  const root = await scratch(t);
  await mkdir(path.join(root, '.opencode'));
  await writeFile(path.join(root, '.opencode/opencode-tooling.config.jsonc'), JSON.stringify(config));
  const calls = [];
  const context = {
    directory: root, worktree: path.dirname(root),
    client: {
      app: { log: async value => { calls.push(['log', value.body.message]); return { data: true }; } },
      session: {
        get: async value => ({ data: { id: value.path.id, ...options.session } }),
        promptAsync: async value => { calls.push(['prompt', value]); return options.response?.() ?? { response: { status: 204 } }; }
      }
    }
  };
  const runtime = await createRuntime(context);
  t.after(() => runtime.dispose());
  return { root, context, runtime, calls };
}

test('the three explicit Sol bindings preserve high and temperature omission', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  for (const name of ['typescript-specialist', 'webview-specialist', 'release-manager']) {
    assert.equal(settings.agent[name].model, 'openai/gpt-6-sol');
    assert.equal(settings.agent[name].variant, 'high');
    assert.equal(Object.hasOwn(settings.agent[name], 'temperature'), false);
  }
  assert.equal(settings.agent['ci-build-engineer'].model, 'opencode-go/deepseek-v4-pro');
  assert.equal(settings.default_agent, 'build');
  assert.equal(Object.hasOwn(settings.agent.plan, 'model'), false);
  assert.equal(Object.hasOwn(settings.agent.build, 'model'), false);
});

test('only one terminal unquoted configured marker is accepted', () => {
  assert.equal(reviewDecision(`Findings complete.\n${prefix}=PASS`, prefix), 'PASS');
  assert.equal(reviewDecision(`${prefix}=FAIL`, prefix), 'FAIL');
  for (const value of [`> ${prefix}=PASS`, `\`${prefix}=PASS\``, `${prefix}=PASS\nmore`, `${prefix}=PASS\n${prefix}=PASS`, `${prefix}=FAIL\n${prefix}=PASS`, 'DOTFILES_REVIEWER_RESULT=PASS', 'DOTFILES_REVIEW_MARKER=PASS', `${prefix}=PASS|FAIL`, `\`\`\`\n${prefix}=PASS\n\`\`\``]) {
    assert.equal(reviewDecision(value, prefix), null, value);
  }
  assert.equal(reviewDecision(`<task id="ses_review" state="completed">\n<task_result>\n${prefix}=PASS\n</task_result>\n</task>`, prefix), 'PASS');
});

test('JSONC parsing handles comments and trailing commas without corrupting strings', async t => {
  const { root, context } = await fixture(t);
  const text = JSON.stringify({ ...config, reviewLabel: 'Review ,}' }).replace(/}$/, ',\n// comment\n}');
  await writeFile(path.join(root, '.opencode/opencode-tooling.config.jsonc'), text);
  const runtime = await createRuntime(context);
  assert.equal(runtime.config.reviewLabel, 'Review ,}');
  await runtime.dispose();
});

test('unfinished Markdown fences and indented markers cannot clear review', () => {
  for (const text of [`\`\`\`text\n${prefix}=PASS`, `~~~text\n${prefix}=PASS`, `\`\`\`\`text\n\`\`\`\n${prefix}=PASS`, `    ${prefix}=PASS`, `\t${prefix}=PASS`]) assert.equal(reviewDecision(text, prefix), null, text);
  assert.equal(reviewDecision(`\`\`\`text\nExample only\n\`\`\`\n${prefix}=PASS`, prefix), 'PASS');
  assert.equal(reviewDecision(`~~~text\nExample only\n~~~\n${prefix}=FAIL`, prefix), 'FAIL');
});

test('malformed configuration disables reminders with no reflected exception detail', async t => {
  const { root, context, calls } = await fixture(t);
  await writeFile(path.join(root, '.opencode/opencode-tooling.config.jsonc'), '{"SYNTHETIC_PRIVATE":');
  assert.equal(await createRuntime(context), null);
  assert.ok(calls.some(([name]) => name === 'log'));
  assert.equal(JSON.stringify(calls).includes('SYNTHETIC_PRIVATE'), false);
});

test('actual picomatch exemptions retain docs and workflow source and reject path escape', async t => {
  const { root, runtime } = await fixture(t);
  assert.equal(runtime.relativeFile('docs/development/opencode-workflow.md'), 'docs/development/opencode-workflow.md');
  assert.equal(runtime.relativeFile('.github/workflows/test.yml'), '.github/workflows/test.yml');
  assert.equal(runtime.relativeFile('.opencode/plugins/review-loop-gate.js'), '.opencode/plugins/review-loop-gate.js');
  for (const file of ['../escape', path.join(root, '../escape'), 'out/extension.js', '.beads/config.yaml', '.opencode/node_modules/package/index.js']) assert.equal(runtime.relativeFile(file), null);
  assert.equal(runtime.relativeFile(path.join(root, 'src/file.ts')), 'src/file.ts');
});

test('marker addresses the current worktree and records deletion and move paths', async t => {
  const { root, context, runtime } = await fixture(t);
  const plugin = await Marker(context);
  t.after(() => plugin.dispose());
  await plugin['tool.execute.after']({ tool: 'apply_patch', sessionID: 'ses_one', args: { patchText: '*** Delete File: old.txt\n*** Update File: before.txt\n*** Move to: after.txt' } }, { metadata: {} });
  assert.deepEqual((await runtime.gate('ses_one')).files, ['old.txt', 'before.txt', 'after.txt']);
  assert.equal(runtime.base, await import('node:fs/promises').then(fs => fs.realpath(root)));
  await plugin.event(user('ses_one'));
  await plugin.event({ event: { type: 'file.watcher.updated', properties: { file: 'deleted.txt', event: 'unlink' } } });
  assert.ok((await runtime.gate('ses_one')).files.includes('deleted.txt'));
  assert.throws(() => runtime.mark('../escape', ['file.txt']), /REVIEW_SESSION_INVALID/);
});

test('gate requires the configured reviewer and preserves other and newer revisions', async t => {
  const { context, runtime } = await fixture(t);
  const plugin = await Gate(context);
  t.after(() => plugin.dispose());
  await runtime.mark('ses_one', ['one.txt']);
  await runtime.mark('ses_two', ['two.txt']);
  const input = { tool: 'task', sessionID: 'ses_one', callID: 'functions.task:1', args: { subagent_type: 'code-reviewer' } };
  await plugin['tool.execute.before'](input, { args: input.args });
  await runtime.mark('ses_one', ['new.txt']);
  await plugin['tool.execute.after'](input, { output: `${prefix}=PASS` });
  assert.ok(await runtime.gate('ses_one'));
  await plugin['tool.execute.before'](input, { args: input.args });
  await plugin['tool.execute.after'](input, { output: `${prefix}=FAIL` });
  assert.ok(await runtime.gate('ses_one'));
  await plugin['tool.execute.before'](input, { args: { subagent_type: 'build' } });
  await plugin['tool.execute.after'](input, { output: `${prefix}=PASS` });
  assert.ok(await runtime.gate('ses_one'));
  await plugin['tool.execute.before'](input, { args: input.args });
  await plugin['tool.execute.after'](input, { output: `${prefix}=PASS` });
  assert.equal(await runtime.gate('ses_one'), null);
  assert.ok(await runtime.gate('ses_two'));
});

test('delivery acknowledgment is recorded once and explicit rejection remains retryable', async t => {
  let attempts = 0;
  const { context, runtime, calls } = await fixture(t, { response: () => ++attempts === 1 ? { error: {}, response: { status: 400 } } : { response: { status: 204 } } });
  const plugin = await Enforcer(context);
  t.after(() => plugin.dispose());
  await runtime.mark('ses_one', ['one.txt']);
  await plugin.event(user('ses_one'));
  await plugin.event(idle('ses_one'));
  await eventually(async () => (await runtime.load('ses_one', 'delivery'))?.status === 'rejected');
  assert.ok(await runtime.gate('ses_one'));
  await plugin.event(idle('ses_one'));
  await eventually(async () => (await runtime.load('ses_one', 'delivery'))?.status === 'delivered');
  await plugin.event(idle('ses_one'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.filter(([name]) => name === 'prompt').length, 2);
});

test('uncertain delivery does not automatically replay a possibly accepted request', async t => {
  const { context, runtime, calls } = await fixture(t, { response: () => { throw new Error('SYNTHETIC_PRIVATE'); } });
  const plugin = await Enforcer(context);
  t.after(() => plugin.dispose());
  await runtime.mark('ses_one', ['one.txt']);
  await plugin.event(user('ses_one'));
  await plugin.event(idle('ses_one'));
  await eventually(() => calls.some(([name, value]) => name === 'log' && value.includes('uncertain')));
  await plugin.event(idle('ses_one'));
  await new Promise(resolve => setTimeout(resolve, 30));
  assert.equal(calls.filter(([name]) => name === 'prompt').length, 1);
  assert.ok(await runtime.gate('ses_one'));
  assert.equal(JSON.stringify(calls).includes('SYNTHETIC_PRIVATE'), false);
});

test('child, reviewer and failed sessions receive no automatic review prompt', async t => {
  for (const kind of ['child', 'reviewer', 'failed']) {
    const { context, runtime, calls } = await fixture(t, { session: kind === 'child' ? { parentID: 'ses_parent' } : {} });
    const plugin = await Enforcer(context);
    t.after(() => plugin.dispose());
    await runtime.mark('ses_one', ['one.txt']);
    await plugin.event(user('ses_one', kind === 'reviewer' ? 'code-reviewer' : 'build'));
    if (kind === 'failed') await plugin.event({ event: { type: 'session.error', properties: { sessionID: 'ses_one' } } });
    await plugin.event(idle('ses_one'));
    await new Promise(resolve => setTimeout(resolve, 30));
    assert.equal(calls.filter(([name]) => name === 'prompt').length, 0, kind);
  }
});

test('injected review request preserves parent authority and whole-change scope', () => {
  const text = reviewRequest(config, 'ses_one', 'revision');
  for (const phrase of ['grants no', 'stopped, paused', 'Leaves return', 'whole intended change', 'reviewer must not edit', `${prefix}=PASS`, `${prefix}=FAIL`]) assert.ok(text.includes(phrase));
  assert.equal(text.includes('fix Must-fix issues'), false);
});

test('the three reviewer agents declare anthropic/claude-opus-5-5 high with no local temperature', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  for (const name of ['plan-reviewer', 'code-reviewer', 'test-strategist']) {
    assert.equal(settings.agent[name].model, 'anthropic/claude-opus-5-5');
    assert.equal(settings.agent[name].variant, 'high');
    assert.equal(Object.hasOwn(settings.agent[name], 'temperature'), false);
  }
  assert.equal(settings.agent['beads-manager'].model, 'openai/gpt-5.6-terra');
});

test('CI push permission declares dry-run allow while real and tag pushes stay ask with no broad grant', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const bash = settings.agent['ci-build-engineer'].permission.bash;
  assert.equal(bash['*'], 'deny');
  assert.equal(bash['git push --dry-run origin main'], 'allow');
  assert.equal(bash['git push origin main'], 'ask');
  assert.equal(bash['git push origin refs/tags/v*'], 'ask');
  assert.equal(Object.hasOwn(bash, 'git push'), false);
  assert.equal(Object.hasOwn(bash, 'git push *'), false);
  assert.equal(Object.hasOwn(bash, 'git push origin *'), false);
  assert.deepEqual(Object.keys(bash).filter(key => key.startsWith('git push')).sort(), ['git push --dry-run origin main', 'git push origin main', 'git push origin refs/tags/v*']);
  for (const [name, agent] of Object.entries(settings.agent)) {
    if (name === 'ci-build-engineer') continue;
    const perms = agent.permission && typeof agent.permission === 'object' ? agent.permission : {};
    const rules = perms.bash && typeof perms.bash === 'object' ? perms.bash : {};
    for (const key of Object.keys(rules)) assert.ok(!key.startsWith('git push'), `${name} grants ${key}`);
  }
});

test('CI tooling permission uses npm lock and installed VSCE instead of Bun and npx', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const ci = settings.agent['ci-build-engineer'].permission;
  assert.equal(ci.edit['.opencode/package-lock.json'], 'allow');
  assert.equal(ci.edit['.opencode/package.json'], 'allow');
  assert.equal(Object.hasOwn(ci.edit, '.opencode/bun.lock'), false);
  assert.equal(Object.hasOwn(ci.bash, 'bun install --frozen-lockfile --ignore-scripts'), false);
  assert.equal(Object.hasOwn(ci.bash, 'npx --no-install vsce ls --no-dependencies'), false);
  assert.equal(ci.bash['./node_modules/.bin/vsce ls --no-dependencies'], 'ask');
  assert.equal(ci.bash['npm ci --ignore-scripts'], 'ask');
  assert.equal(ci.bash["git diff --no-ext-diff --no-textconv --cached | grep -E '^\\+.*(#|//|/\\*)'"], 'ask');
  assert.equal(ci.bash['*agent-wt-merge*--close-beads*'], 'deny');
  assert.equal(ci.task, 'deny');
  assert.equal(ci.edit['*'], 'deny');
  for (const key of ['.opencode/opencode.jsonc', '.opencode/agents/**', '.opencode/instructions/**', 'AGENTS.md', 'CLAUDE.md', 'docs/development/opencode-workflow.md', 'docs/development/agent-evaluation.md']) assert.equal(Object.hasOwn(ci.edit, key), false, key);
});

test('OpenCode tooling manifest and lock pin plugin and sdk 1.18.31 with exact integrity', async () => {
  const manifest = JSON.parse(await readFile(new URL('../../.opencode/package.json', import.meta.url), 'utf8'));
  const lock = JSON.parse(await readFile(new URL('../../.opencode/package-lock.json', import.meta.url), 'utf8'));
  assert.deepEqual(manifest.dependencies, {
    '@opencode-ai/plugin': '1.18.31',
    'jsonc-parser': '3.3.1',
    'picomatch': '4.0.4'
  });
  assert.equal(lock.lockfileVersion, 3);
  assert.deepEqual(lock.packages[''].dependencies, manifest.dependencies);
  assert.equal(lock.packages['node_modules/@opencode-ai/plugin'].version, '1.18.31');
  assert.equal(lock.packages['node_modules/@opencode-ai/sdk'].version, '1.18.31');
  assert.equal(lock.packages['node_modules/@opencode-ai/plugin'].integrity, 'sha512-Rdc1bPK06PByaGyGd0kf7JUZ4pTkexz2OOUNlqZWLpHOiMEZ+/rFGjt46ypZ3QwA697gNdWwwwQbHbKG5NMwGA==');
  assert.equal(lock.packages['node_modules/@opencode-ai/sdk'].integrity, 'sha512-Raouthf8Lhe9edjvYeeSK7SgvdoU6bBjH9qV3f70dHoa6h+z0X2TMz/e22/wKp/StlFUZ4kIRpYYxFnY8/k01w==');
  assert.equal(lock.packages['node_modules/@opencode-ai/plugin'].dependencies['@opencode-ai/sdk'], '1.18.31');
  assert.equal(lock.packages['node_modules/jsonc-parser'].version, '3.3.1');
  assert.equal(lock.packages['node_modules/picomatch'].version, '4.0.4');
});
