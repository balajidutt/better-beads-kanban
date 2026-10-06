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

test('the four explicit Sol bindings preserve high and temperature omission', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  for (const name of ['typescript-specialist', 'webview-specialist', 'release-manager', 'ci-build-engineer']) {
    assert.equal(settings.agent[name].model, 'openai/gpt-6-sol');
    assert.equal(settings.agent[name].variant, 'high');
    assert.equal(Object.hasOwn(settings.agent[name], 'temperature'), false);
  }
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

test('executing and review roles default to ask behind explicit deny blocks; planning roles keep default deny', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const reviewers = ['plan-reviewer', 'code-reviewer', 'test-strategist'];
  const flipped = ['beads-manager', 'typescript-specialist', 'webview-specialist', 'ci-build-engineer', 'release-manager', ...reviewers];
  assert.equal(settings.agent.build.permission.bash, 'deny');
  assert.equal(settings.agent.plan.permission.bash['*'], 'deny');
  assert.equal(settings.permission.bash, 'deny');
  for (const [name, agent] of Object.entries(settings.agent)) {
    const bash = agent.permission?.bash;
    if (typeof bash !== 'object') continue;
    assert.equal(bash['*'], flipped.includes(name) ? 'ask' : 'deny', name);
    for (const [key, action] of Object.entries(bash)) {
      if (action !== 'deny') assert.equal(bashAction(bash, key.replaceAll('*', 'x')), action, `${name}: a later deny shadows ${key}`);
    }
  }
  const everyRole = ['git commit -m x', 'git -c user.name=Claude commit -m x', 'git push origin fix/x', 'git --no-optional-locks -c core.fsmonitor=false push origin main', 'git reset --hard HEAD', 'git clean -fdx', 'git restore src/x.ts', 'git checkout -- src/x.ts', 'git stash push -u', 'git rebase main', 'git merge main', 'git branch -D x', 'git tag v9', 'git config user.name x', 'git worktree remove ../x', 'gh release create v9', 'gh auth switch', 'gh pr create', 'npm publish', 'npm run release:package', 'scripts/release-fork-vsix.sh --release-issue bbk-ek0 --dry-run', 'command bd -C "/m" init', 'bd dolt push', 'sh -c "git push origin main"', 'bash scripts/x.sh', 'eval x', 'sudo ls', 'cat .env', 'rm -rf /', 'rm -rf ~/x', 'dd if=/dev/zero of=x',
    'git -C /main merge fix/x', 'git --no-optional-locks -c core.fsmonitor=false merge x', 'git -C /x restore f', 'git -C /x tag v9', 'git -C /x branch -D x', 'git -C /x worktree remove ../x', 'git -C /x worktree prune', 'git -C /x config user.name x', 'git -C /x update-ref -d refs/heads/main', 'command git -C /x push origin main', 'command git -C /x commit -m x',
    'git pull upstream main', 'git -C /x pull --rebase origin main', 'git checkout main', 'git checkout .', 'git checkout -f main', 'git switch --discard-changes main', 'git reset HEAD~1', 'git reset --soft HEAD~1', 'git branch -f main HEAD~5', 'git branch -M main', 'git branch --delete --force x',
    'command npm publish', 'command npm install', 'npm install', 'npm i lodash', 'npm ci', 'npm add lodash', 'npm rm x', 'command gh pr create', 'command gh auth switch', '/opt/homebrew/bin/gh release create v1',
    'command bd -C "/m" sql "select 1"', 'command bd -C "/m" compact', 'command bd -C "/m" delete bbk-1', 'command bd -C "/m" hooks install', 'command bd -C "/m" vc commit', 'command bd -C "/m" federation sync',
    'rm -rf /*', 'rm -fr /', 'rm -r -f ~', 'ls ~/.ssh', 'ls .beads', 'cat ".env"', 'cat ./.env.local', 'source .env'];
  const reviewerOnly = ['git add -A', 'git -C /x add f', 'git apply x.patch', 'git diff --output=x', 'git fetch origin', 'git branch new', 'npm test', 'command npm test', 'npx vsce ls', 'node -e 1', './node_modules/.bin/mocha', 'python3 -c 1', 'patch -p1 -i x.patch', 'scripts/build-local-vsix.sh', './scripts/clean-test-data.sh', '/repo/scripts/visual-test-launch.sh', '/repo/assets/check-pipeline.py', 'sed -i s/a/b/ x', 'tee x', 'cp a b', 'mv a b', 'rm x', 'touch x', 'mkdir x', 'curl -s https://example.com', 'find . -name x -delete', 'xargs rm'];
  const notCi = ["oc-commit -m 'feat: x'", 'cc-commit -m x', 'assets/agent-wt-merge ff --actor claude', '.opencode/bin/agent-wt-merge prepare-ci', '/repo/assets/agent-wt-merge inspect --json'];
  for (const name of flipped) {
    const bash = settings.agent[name].permission.bash;
    for (const command of ['scripts/release-fork-vsix.sh --release-issue bbk-ek0', './scripts/release-fork-vsix.sh --release-issue bbk-ek0', '/repo/scripts/release-fork-vsix.sh --release-issue bbk-ek0', 'bash scripts/release-fork-vsix.sh --release-issue bbk-ek0']) assert.equal(bashAction(bash, command), 'deny', `${name} ${command}`);
  }
  const helperPaths = ['scripts/release-fork-vsix.sh', 'scripts/bd-sync.sh', 'assets/agent-wt-merge', 'terminal/scripts/test.mjs'];
  for (const name of ['release-manager', 'code-reviewer']) {
    const bash = settings.agent[name].permission.bash;
    for (const target of helperPaths) {
      for (const form of [`git diff --no-ext-diff --no-textconv 5d31f0be..HEAD -- ${target}`, `git log --oneline --decorate --reverse 5d31f0be..HEAD -- ${target}`]) assert.equal(bashAction(bash, form), 'ask', `${name} ${form}`);
    }
  }
  assert.equal(bashAction(settings.agent['release-manager'].permission.bash, 'git ls-files -- scripts/release-fork-vsix.sh'), 'allow');
  for (const name of flipped) {
    const bash = settings.agent[name].permission.bash;
    for (const command of everyRole) assert.equal(bashAction(bash, command), 'deny', `${name} ${command}`);
    for (const command of reviewerOnly) assert.equal(bashAction(bash, command) === 'deny', reviewers.includes(name), `${name} ${command}`);
    for (const command of notCi) assert.equal(bashAction(bash, command) === 'deny', name !== 'ci-build-engineer', `${name} ${command}`);
    for (const command of ['ls -la', 'git -C /x status --porcelain', 'git -C /x log --oneline -5', 'git diff --no-ext-diff --no-textconv -- configs/pipeline-guard.json addons/x', 'rg TODO src', 'rg process.env src', 'rg beadsWatch src', 'wc -l package.json']) assert.equal(bashAction(bash, command), 'ask', `${name} ${command}`);
  }
  const ci = settings.agent['ci-build-engineer'].permission.bash;
  assert.equal(bashAction(ci, 'npm ci --ignore-scripts'), 'ask');
  assert.equal(bashAction(ci, "oc-commit -m 'fix: a -> b'"), 'ask');
  assert.equal(bashAction(ci, 'assets/agent-wt-merge ff --actor claude --close-beads bbk-1'), 'deny');
  const bm = settings.agent['beads-manager'].permission.bash;
  for (const command of ['command bd -C "/m" update bbk-1 --notes "run bd dolt push later"', 'command bd -C "/m" close bbk-1 --reason "deleted import"']) assert.equal(bashAction(bm, command), 'ask', command);
});

test('CI may dry-run a main push while real main and tag pushes are denied to every role', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const bash = settings.agent['ci-build-engineer'].permission.bash;
  assert.equal(bashAction(bash, 'git push --dry-run origin main'), 'allow');
  for (const command of ['git push origin main', 'git push origin refs/tags/v2.2.3', 'git push --force origin main', 'git push -u origin fix/x', 'command git push origin main', 'git -C /x push origin main']) {
    assert.equal(bashAction(bash, command), 'deny', command);
  }
  assert.deepEqual(Object.entries(bash).filter(([key, action]) => key.startsWith('git push') && action !== 'deny'), [['git push --dry-run origin main', 'allow']]);
  for (const [name, agent] of Object.entries(settings.agent)) {
    if (name === 'ci-build-engineer') continue;
    const rules = agent.permission?.bash && typeof agent.permission.bash === 'object' ? agent.permission.bash : {};
    for (const [key, action] of Object.entries(rules)) assert.ok(!key.startsWith('git push') || action === 'deny', `${name} grants ${key}`);
  }
});

test('build external directory access falls back to deny around the Plannotator plans grant', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const external = settings.agent.build.permission.external_directory;
  assert.deepEqual(Object.entries(external), [['*', 'deny'], ['$HOME/.plannotator/plans/**', 'allow']]);
});

// Copy of the {env:} substitution in OpenCode v1.18.31 packages/opencode/src/config/variable.ts, with the environment passed in.
function substituteEnv(text, env) {
  return text.replace(/\{env:([^}]+)\}/g, (_, name) => env[name] || '');
}

test('Plannotator plugin takes its version from PLANNOTATOR_PIN_VERSION and keeps the user-managed CLI options', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const docs = await readFile(new URL('../../docs/development/opencode-workflow.md', import.meta.url), 'utf8');
  assert.equal(settings.plugin.length, 1);
  assert.equal(settings.plugin[0].length, 2);
  const [spec, options] = settings.plugin[0];
  assert.equal(spec, '@plannotator/opencode@{env:PLANNOTATOR_PIN_VERSION}');
  assert.deepEqual(options, { workflow: 'user-managed', runtime: 'cli', planningAgents: ['plan', 'plan-GPT-xhigh', 'special-builder', 'agent-engineer'] });
  assert.ok(docs.includes('The project registers `@plannotator/opencode@{env:PLANNOTATOR_PIN_VERSION}`'));
  assert.equal(docs.includes('`PLANNOTATOR_VERSION`'), false);
  assert.ok(docs.includes('The following results are historical. They were recorded against the earlier exact pin `@plannotator/opencode@0.27.14`'));
});

test('the Plannotator spec resolves to the pinned version when the variable is set and to an unpinned spec when it is unset or empty', async () => {
  const raw = await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8');
  const resolve = env => JSON.parse(substituteEnv(raw, env)).plugin[0];
  const [pinned, options] = resolve({ PLANNOTATOR_PIN_VERSION: '0.27.14' });
  assert.equal(pinned, '@plannotator/opencode@0.27.14');
  assert.deepEqual(options, { workflow: 'user-managed', runtime: 'cli', planningAgents: ['plan', 'plan-GPT-xhigh', 'special-builder', 'agent-engineer'] });
  for (const env of [{}, { PLANNOTATOR_PIN_VERSION: '' }]) assert.equal(resolve(env)[0], '@plannotator/opencode@');
  assert.equal(resolve({ PLANNOTATOR_VERSION: '9.9.9' })[0], '@plannotator/opencode@');
  assert.equal((raw.match(/\{env:[^}]+\}/g) ?? []).length, 1);
  assert.equal(raw.includes('{file:'), false);
});

test('every workflow role may read the Plannotator plans directory and keeps its external default otherwise', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const lifecycle = await readFile(new URL('../../.opencode/instructions/development-lifecycle.md', import.meta.url), 'utf8');
  assert.ok(lifecycle.includes('Read only the exact plan path your handoff, dispatch or Plannotator result names'));
  const defaults = { plan: 'deny', build: 'deny', 'plan-reviewer': 'deny', 'code-reviewer': 'deny', 'typescript-specialist': 'deny', 'webview-specialist': 'deny', 'test-strategist': 'deny', 'beads-manager': 'ask', 'ci-build-engineer': 'ask', 'release-manager': 'ask' };
  for (const [name, fallback] of Object.entries(defaults)) {
    const external = settings.agent[name].permission.external_directory;
    assert.deepEqual(Object.entries(external), [['*', fallback], ['$HOME/.plannotator/plans/**', 'allow']], name);
    assert.equal(bashAction(external, '$HOME/.plannotator/plans/stage-b-2026-09-30-approved.md'), 'allow', name);
    assert.equal(bashAction(external, '$HOME/.ssh/id_ed25519'), fallback, name);
  }
});

test('beads-manager lists worktrees only through the exact porcelain query', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const bash = settings.agent['beads-manager'].permission.bash;
  assert.deepEqual(Object.entries(bash).filter(([key, action]) => key.startsWith('git worktree') && action !== 'deny'), [['git worktree list --porcelain', 'allow']]);
  for (const command of ['git worktree add ../x', 'git worktree remove ../x', 'git worktree prune']) assert.equal(bashAction(bash, command), 'deny', command);
  const keys = Object.keys(bash);
  assert.ok(keys.indexOf('git worktree list --porcelain') > keys.indexOf('*'));
});

test('release history and diff families ask while the later exact diff stays allowed', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const bash = settings.agent['release-manager'].permission.bash;
  const keys = Object.keys(bash);
  const families = [
    'git log --oneline --decorate --reverse *',
    'git diff --no-ext-diff --no-textconv --stat *',
    'git diff --no-ext-diff --no-textconv --name-status *',
    'git diff --no-ext-diff --no-textconv *'
  ];
  for (const family of families) {
    assert.equal(bash[family], 'ask', family);
    assert.ok(keys.indexOf(family) > keys.indexOf('*'), family);
  }
  // OpenCode applies the last matching rule, and a trailing " *" also matches the bare command.
  assert.equal(bash['git diff --no-ext-diff --no-textconv'], 'allow');
  assert.ok(keys.indexOf('git diff --no-ext-diff --no-textconv') > keys.indexOf('git diff --no-ext-diff --no-textconv *'));
  for (const key of keys.filter(key => /^git (log|diff)\b/.test(key) && key.endsWith('*'))) assert.equal(bash[key], 'ask', key);
});

// Copy of Wildcard.match from OpenCode v1.18.31 packages/core/src/util/wildcard.ts.
function wildcardMatch(input, pattern) {
  const normalized = input.replaceAll('\\', '/');
  let escaped = pattern.replaceAll('\\', '/').replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.');
  if (escaped.endsWith(' .*')) escaped = escaped.slice(0, -3) + '( .*)?';
  return new RegExp('^' + escaped + '$', 's').test(normalized);
}

function bashAction(rules, command) {
  return Object.entries(rules).findLast(([pattern]) => wildcardMatch(command, pattern))?.[1] ?? 'ask';
}

async function contractGitForms(name) {
  const text = await readFile(new URL(`../../.opencode/agents/${name}.md`, import.meta.url), 'utf8');
  return [...text.matchAll(/`(git [^`]+)`/g)].map(([, form]) => form
    .replaceAll('<base>', '5d31f0be42def32d1d9b1cc7f5e11dbf8c131034')
    .replaceAll('<main-sha>', '208ecf71193170aba2ca005c44dbef71fe3a3ccb')
    .replaceAll('<sha>', 'f334ab5')
    .replaceAll('<tag>', 'v2.2.2')
    .replaceAll('<paths>', 'CHANGELOG.md package.json'));
}

test('wildcard copy keeps trailing-space optionality and anchors the whole command', () => {
  assert.equal(wildcardMatch('git diff --no-ext-diff --no-textconv', 'git diff --no-ext-diff --no-textconv *'), true);
  assert.equal(wildcardMatch('git diff --name-status HEAD', 'git diff --no-ext-diff --no-textconv *'), false);
  assert.equal(wildcardMatch('git -C /repo rev-parse --show-toplevel', 'git rev-parse *'), false);
});

test('release-manager Git forms named in its contract resolve to their documented actions', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const bash = settings.agent['release-manager'].permission.bash;
  assert.equal(Object.keys(bash)[0], '*');
  const forms = await contractGitForms('release-manager');
  assert.equal(forms.length, 15);
  assert.ok(forms.includes('git rev-parse --verify "refs/tags/v2.2.2^{commit}"'));
  const asks = form => /^git (log|ls-remote) /.test(form) || (/^git diff /.test(form) && form.includes('..HEAD'));
  for (const form of forms) assert.equal(bashAction(bash, form), asks(form) ? 'ask' : 'allow', form);
  assert.equal(bashAction(bash, 'git -c core.fsmonitor=false status --porcelain=v1 -uall'), 'ask');
});

test('release-manager postpublication gh forms named in its contract ask and stay on the fork', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const bash = settings.agent['release-manager'].permission.bash;
  const text = await readFile(new URL('../../.opencode/agents/release-manager.md', import.meta.url), 'utf8');
  const forms = [...text.matchAll(/`(gh [^`]+)`/g)].map(([, form]) => form.replaceAll('<tag>', 'v2.3.0'));
  assert.equal(forms.length, 3);
  for (const form of forms) {
    assert.ok(form.includes('--repo balajidutt/better-beads-kanban'), form);
    assert.equal(bashAction(bash, form), 'ask', form);
  }
  assert.equal(bash['gh *'], 'deny');
  for (const key of Object.keys(bash).filter(key => key.startsWith('gh ') && key !== 'gh *')) {
    assert.equal(bash[key], 'ask', key);
    assert.match(key, /^gh release (view|download) /, key);
    assert.ok(Object.keys(bash).indexOf(key) > Object.keys(bash).indexOf('gh *'), key);
  }
  assert.equal(bashAction(bash, 'gh release create v2.3.0 --repo balajidutt/better-beads-kanban'), 'deny');
  assert.equal(bashAction(bash, 'gh auth switch --user balajidutt'), 'deny');
  assert.equal(bashAction(bash, 'gh release download v2.3.0 --repo balajidutt/better-beads-kanban --pattern SHA256SUMS --dir /tmp'), 'deny');
  assert.equal(bashAction(bash, 'gh release delete v2.3.0 --repo balajidutt/better-beads-kanban'), 'deny');
});

test('code-reviewer history forms ask while its exact inspection forms stay allowed', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const bash = settings.agent['code-reviewer'].permission.bash;
  assert.equal(Object.keys(bash)[0], '*');
  const forms = await contractGitForms('code-reviewer');
  assert.equal(forms.length, 5);
  for (const form of forms) assert.equal(bashAction(bash, form), form === 'git rev-parse HEAD' ? 'allow' : 'ask', form);
  for (const exact of ['git diff --no-ext-diff --no-textconv', 'git diff --no-ext-diff --no-textconv --cached', 'git diff --no-ext-diff --no-textconv --stat', 'git diff --no-ext-diff --no-textconv --cached --stat', 'git log --oneline -10', 'git --no-optional-locks -c core.fsmonitor=false status --porcelain=v1 -uall']) {
    assert.equal(bashAction(bash, exact), 'allow', exact);
  }
});

test('bd and sync forms named in contracts resolve to ask for their role', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const expected = { 'release-manager': 4, 'code-reviewer': 2, 'beads-manager': 3 };
  for (const [name, count] of Object.entries(expected)) {
    const text = await readFile(new URL(`../../.opencode/agents/${name}.md`, import.meta.url), 'utf8');
    const forms = [...text.matchAll(/`((?:command bd -C |scripts\/bd-sync\.sh)[^`]*)`/g)].map(([, form]) => form
      .replaceAll('<main>', '/Users/example/Beads-Kanban')
      .replaceAll('<id>', 'bbk-ek0')
      .replaceAll('<title>', 'Cut the 2.2.3 release')
      .replaceAll('<reason>', 'Released v2.2.3'));
    assert.equal(forms.length, count, name);
    for (const form of forms) assert.equal(bashAction(settings.agent[name].permission.bash, form), 'ask', `${name} ${form}`);
  }
  const bm = settings.agent['beads-manager'].permission.bash;
  for (const command of ['command bd -C "/m" init', 'command bd -C "/m" dolt push', 'bd dolt pull']) assert.equal(bashAction(bm, command), 'deny', command);
});

test('beads-manager denies bd commands outside the backlog procedure, including those added in bd 1.3', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const bm = settings.agent['beads-manager'].permission.bash;
  const subcommands = ['sync', 'serve', 'conflicts resolve bbk-1', 'reclaim', 'unclaim bbk-1', 'heartbeat bbk-1', 'hb bbk-1', 'events prune --below 5', 'provenance append', 'codex-hook', 'cursor-hook', 'db-proxy-child',
    'purge', 'prune --older-than 30d', 'gc', 'flatten', 'rename bbk-1 bbk-2', 'rename-prefix abc', 'migrate-issues --to x', 'migrate-personal -y', 'doctor --fix --yes', 'batch', 'edit bbk-1', 'upgrade', 'setup claude', 'worktree create x', 'repo sync', 'branch feature-x', 'mol burn bbk-1',
    'github sync', 'gitlab sync', 'jira sync', 'linear sync', 'notion sync', 'ado sync', 'mail inbox', 'ship cap'];
  for (const sub of [...subcommands, 'protomolecule burn bbk-1']) {
    for (const command of [`bd ${sub}`, `command bd ${sub}`, `command bd -C "/m" ${sub}`, `bd --json ${sub}`, `command bd --readonly -C "/m" ${sub}`, `command bd --db /tmp/x.db ${sub}`, `/opt/homebrew/bin/bd ${sub}`, `/opt/homebrew/bin/bd -C /m ${sub}`, `~/go/bin/bd ${sub}`, `./bd ${sub}`]) assert.equal(bashAction(bm, command), 'deny', command);
  }
  for (const command of ['command bd -C "/m" --global update bbk-1 --notes x', 'command bd -C "/m" --db /tmp/x.db create --title x', 'command bd --database other -C "/m" close bbk-1 --reason x', 'command bd -C "/m" --db=/tmp/x.db show bbk-1', 'bd --global list', '/usr/local/bin/bd -C /m --database other ready', 'command bd -C "/m" update bbk-1 --notes x --db /tmp/x.db', 'command bd -C "/m" mol wisp create proto-x', 'command bd -C "/m" protomolecule wisp create proto-x']) {
    assert.equal(bashAction(bm, command), 'deny', command);
  }
  for (const command of ['command bd -C "/m" create --title "Fix sync after purge"', 'command bd -C "/m" update bbk-1 --notes "gc and serve"', 'command bd -C "/m" close bbk-1 --reason "after events prune"']) {
    assert.equal(bashAction(bm, command), 'ask', command);
  }
});

test('only beads-manager may write or sync the backlog; other flipped roles keep their exact read forms', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const writes = ['/opt/homebrew/bin/bd update bbk-1 --notes y', '~/go/bin/bd close bbk-1 --reason x', 'command bd -C "/m" update bbk-1 --notes y', 'command bd -C "/m" create --title x', 'command bd -C "/m" close bbk-1 --reason done', 'bd update bbk-1 --claim', 'command bd close bbk-1 --reason --help', 'scripts/bd-sync.sh', 'command bd -C "/m" update bbk-1 --notes --readonly'];
  for (const name of ['typescript-specialist', 'webview-specialist', 'ci-build-engineer', 'release-manager', 'plan-reviewer', 'code-reviewer', 'test-strategist']) {
    const bash = settings.agent[name].permission.bash;
    for (const command of writes) assert.equal(bashAction(bash, command), 'deny', `${name} ${command}`);
  }
  assert.equal(bashAction(settings.agent['release-manager'].permission.bash, 'command bd -C "/m" --readonly show bbk-ek0'), 'ask');
  assert.equal(bashAction(settings.agent['code-reviewer'].permission.bash, 'command bd -C "/m" --readonly dep list bbk-ek0 --type blocks'), 'ask');
  assert.equal(bashAction(settings.agent['ci-build-engineer'].permission.bash, 'command bd -C "/m" --readonly show bbk-ek0'), 'deny');
  for (const name of ['plan', 'release-manager']) assert.equal(bashAction(settings.agent[name].permission.bash, 'command bd -C "/m" --readonly blocked --json'), 'ask', name);
  for (const name of ['ci-build-engineer', 'code-reviewer', 'typescript-specialist']) assert.equal(bashAction(settings.agent[name].permission.bash, 'command bd -C "/m" --readonly blocked --json'), 'deny', name);
  const agents = await readFile(new URL('../../AGENTS.md', import.meta.url), 'utf8');
  assert.ok(agents.includes('Claim it when preparation starts and keep it in progress through publication, like any other work. It is ready when it is absent from `bd blocked`'));
  const manager = await readFile(new URL('../../.opencode/agents/beads-manager.md', import.meta.url), 'utf8');
  assert.ok(manager.includes('Claims start ordinary implementation or approved release preparation, not backlog grooming.'));
  assert.equal(manager.includes('not backlog grooming or release preparation'), false);
  const bm = settings.agent['beads-manager'].permission.bash;
  assert.equal(bashAction(bm, 'command bd -C "/m" update bbk-1 --notes y'), 'ask');
  assert.equal(bashAction(bm, 'scripts/bd-sync.sh'), 'ask');
  for (const name of ['typescript-specialist', 'release-manager', 'code-reviewer']) {
    for (const helper of ['scripts/bd-sync.sh', '/m/scripts/bd-sync.sh', './scripts/bd-sync.sh']) assert.equal(bashAction(settings.agent[name].permission.bash, helper), 'deny', `${name} ${helper}`);
  }
});

test('CI names and may run its branch identity query', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const text = await readFile(new URL('../../.opencode/agents/ci-build-engineer.md', import.meta.url), 'utf8');
  assert.ok(text.includes('`git branch --show-current`'));
  assert.equal(bashAction(settings.agent['ci-build-engineer'].permission.bash, 'git branch --show-current'), 'allow');
});

test('the CHANGELOG heading stays undated through preparation and is dated in the final pre-publication commit', async () => {
  const contract = await readFile(new URL('../../.opencode/agents/release-manager.md', import.meta.url), 'utf8');
  assert.ok(contract.includes('draft CHANGELOG first with an undated `## [X.Y.Z]` heading'));
  assert.ok(contract.includes('Date the heading only in the final pre-publication commit, on the publication day and with the date the human confirms, after preparation has landed; that commit needs its own approval and landing, and a real release refuses an undated heading.'));
  const releasing = await readFile(new URL('../../RELEASING.md', import.meta.url), 'utf8');
  assert.ok(releasing.includes('Leave the heading undated during preparation'));
  assert.ok(releasing.includes('### 4. Date the CHANGELOG heading'));
  assert.ok(releasing.includes('`CHANGELOG_UNDATED`'));
  assert.ok(releasing.indexOf('### 3. Dry run') < releasing.indexOf('### 4. Date the CHANGELOG heading'));
  assert.ok(releasing.indexOf('### 4. Date the CHANGELOG heading') < releasing.indexOf('### 5. Ship'));
});

test('the CI contract and merge procedure allow exactly one prepare-ci retry after an inspection race', async () => {
  const contract = await readFile(new URL('../../.opencode/agents/ci-build-engineer.md', import.meta.url), 'utf8');
  assert.ok(contract.includes('may be invoked a second time under that approval while HEAD is still the approved SHA'));
  assert.ok(contract.includes('anything but `Reusing already published` at that SHA, or a second stop, ends the operation.'));
  const procedure = (await readFile(new URL('../../docs/development/github-worktree-merge.md', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
  assert.ok(procedure.includes('may be invoked a second time under the same approval while the feature worktree HEAD is still the approved SHA'));
  assert.ok(procedure.includes('A `Published` line instead means a different SHA went out under an approval that did not name it: stop and report it.'));
  const helper = await readFile(new URL('../../assets/github_pipeline.py', import.meta.url), 'utf8');
  for (const where of ['during inspection', 'during pagination', 'across required workflows']) assert.ok(helper.includes(`raise PipelineError("GitHub evidence changed ${where}; check again")`), where);
});

test('AGENTS.md states the intent-and-boundaries model in harness-neutral terms and drops the per-step approval rules', async () => {
  const agents = (await readFile(new URL('../../AGENTS.md', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
  for (const text of [
    'An approved plan is a boundary contract, not a script.',
    '| E | Pushes of main, tags, or anything else outside the merge helper\'s own publication, backlog sync, release dry runs and publication, account changes, and hook installation, modification, or validation | the operator runs it; agents hand over the exact command |',
    'An operation is one approved plan, from its approval to its final report; the operator is the human directing the session',
    'The targets of the default steps are the plan\'s worktree branch, the `origin` remote and the reviewed commit\'s SHA.',
    '`npm ci --ignore-scripts` when dependency entries change or `node_modules/.package-lock.json` is missing',
    '**Default chain.** Approving a plan authorizes its work through landing as an ordered chain',
    '(3) independent review passes on the exact final diff with no unresolved must-fix finding',
    'A failed gate, a review failure or an unresolved must-fix finding is a failed step',
    'Closure is never a default: the plan lists it with the close reason',
    'No plan authorizes a class E operation.',
    "Only three inputs carry the operator's authority:",
    'in OpenCode, the result of `plan`\'s `submit_plan` call through Plannotator, or without Plannotator an operator message, sent after the most recent plan the session presented, that approves it; a reply with conditions or requested changes is a rejection)',
    'It cannot add one:',
    'retry a guarded helper once, only for an error its documented contract names as safe to retry',
    '(7) a denied class B, C or D action; (8) a failed required step.',
    'Evidence the operator supplies through an accepted channel satisfies an item unless the plan marks it must-observe',
    'A timeout, a retry, a client error or a restart is not a change.',
    'Without them, a GitHub issue or an explicit tracking waiver satisfies the tracking rule, and changes land through a pull request',
    'Backlog sync is class E: the operator runs `scripts/bd-sync.sh`'
  ]) assert.ok(agents.includes(text), text);
  for (const gone of [
    'Implementation approval grants none of these implicitly.',
    'need separate approval naming targets and effects',
    'exact operation approval permit it',
    'Unresolved annotations, denial, scope conflicts, or a new human pause suspend continuation.',
    'Authorized routine backlog sync uses',
    'Propose the commit message and exact lifecycle commands when ready, then wait for approval.',
    'Use the exact approved plan and current handoff'
  ]) assert.equal(agents.includes(gone), false, gone);
  const contributing = await readFile(new URL('../../CONTRIBUTING.md', import.meta.url), 'utf8');
  assert.ok(contributing.includes('\n## Maintainer environment\n'));
  assert.ok(agents.includes('[CONTRIBUTING.md](CONTRIBUTING.md#maintainer-environment)'));
});

test('the OpenCode lifecycle states its accepted channels, plan approval forms and approval recording, and the Beads instructions follow the plan model', async () => {
  const lifecycle = (await readFile(new URL('../../.opencode/instructions/development-lifecycle.md', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
  for (const text of [
    'In OpenCode the accepted channels are: the operator\'s message (a user-role message) in the primary session; the operator\'s answer to a question asked with the question tool in the primary session; and the result of a `submit_plan` call made in the primary session.',
    'plan revises the plan from the feedback and submits it again',
    'Such an approval cannot add an operation, file, role or issue.',
    'With a new approval through an accepted channel, it may continue the stopped session with its task_id or dispatch a fresh one; without one it does neither.',
    'must not attempt such changes through any other form',
    'admits only the verified helper executable with its documented flags, never a lookalike path',
    'Classify a denial by the harness\'s actual outcome for the call',
    'hook changes are class E by policy and have no deny rule',
    'An operator message sent after the most recent plan that approves it is the approval; a reply with conditions or requested changes is a rejection.',
    'After compaction, a plan that existed only as session text is void until the operator supplies it again.',
    'the primary asks with the question tool for class C or D, using the exact operation and target as the option label',
    'an approval quoted only in an earlier dispatch of a continued task session is void',
    'returns a command\'s stdout and stderr to the model but never its exit code.',
    'Agents hand the operator the exact command in every case.'
  ]) assert.ok(lifecycle.includes(text), text);
  for (const gone of ['Separate approval is required for commits', 'At CI\'s permission prompt the human chooses Once', 'deny every class E command']) assert.equal(lifecycle.includes(gone), false, gone);
  const handoff = await readFile(new URL('../../.opencode/instructions/beads-plan-handoff.md', import.meta.url), 'utf8');
  assert.ok(handoff.includes('Backlog writes require an approved plan that names the issue IDs'));
  assert.ok(handoff.includes('Backlog sync is class E: the operator runs scripts/bd-sync.sh'));
  assert.ok(handoff.includes('Agents never run it, its `--pull` or `--flush` modes, or bare bd dolt push/pull'));
  assert.ok(handoff.includes('plus the close reason the plan lists to beads-manager'));
  assert.ok(handoff.includes('A follow-up needs the plan to state its title, type, priority, description and links.'));
  const backlog = await readFile(new URL('../../.opencode/instructions/beads-backlog-workflow.md', import.meta.url), 'utf8');
  for (const [name, text] of [['handoff', handoff], ['backlog', backlog]]) {
    for (const gone of ['bootstrap pause', 'user-confirmed', 'Separately approved sync']) assert.equal(text.includes(gone), false, `${name} ${gone}`);
  }
});

test('build runs the default chain and plan writes boundary-contract plans', async () => {
  const build = (await readFile(new URL('../../.opencode/agents/build.md', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
  for (const text of [
    'Unless the plan excludes them, run the default chain after a passing review',
    'continue from the commit (AGENTS.md steps 4-7): dispatch ci-build-engineer to commit exactly the reviewed diff with the reviewed message verbatim',
    'draft the commit message following CONTRIBUTING.md, then send the actual scope, diff, evidence and that message to code-reviewer',
    'A hook-induced change reported by the commit step returns to step 6.',
    'with the plan path or its verbatim text, the lifecycle\'s dispatch fields',
    'dispatch release-manager for the one-line CHANGELOG dating edit',
    'For a release plan whose phase 2 the plan states',
    'A failed step is trigger 8.',
    'Hand the operator the exact class E commands',
    'Only beads-manager closes issues, and only those the plan lists with their close reasons',
    'run the publication-day phase when the operator says they are publishing: ask the date once at the start of phase 2',
    'Approvals relied on, quoted with their channels'
  ]) assert.ok(build.includes(text), text);
  for (const gone of ['propose the commit message without committing', 'Route each separately approved lifecycle operation', 'explicit closure approval']) assert.equal(build.includes(gone), false, gone);
  const plan = (await readFile(new URL('../../.opencode/agents/plan.md', import.meta.url), 'utf8')).replace(/\s+/g, ' ');
  for (const text of [
    'Write evidence-backed plans that state intent and boundaries, not scripts',
    'a plan authorizes a helper by reference and never restates, reorders or forbids its steps',
    'every acceptance item names a role and tool in scope that can produce it, and no open question concerns required evidence',
    'one plan per turn, and state that no earlier approval carries over to a revised plan',
    'On a denial or annotations, revise from the feedback and submit again',
    '- Budgets: attempts per gate (3 unless stated).',
    '- Scope: files (globs) with the owning role for each, Beads issues, worktrees.',
    '- Exclusions: any default step the plan does not authorize',
    'and any item marked must-observe',
    '- Operator decisions recorded up front, such as a release\'s QA decision (smoke test done, waived or not required).',
    'closures with their close reasons',
    'stop-on-denial for a named mutating step',
    'phase 2, on the publication day, the date asked once, the CHANGELOG dating commit through the same chain'
  ]) assert.ok(plan.includes(text), text);
  for (const gone of ['ordered steps, verification and approvals', 'Incorporate denial/annotations without mutation']) assert.equal(plan.includes(gone), false, gone);
});

test('dependency preparation triggers on dependency entries, not a root version change', async () => {
  for (const file of ['instructions/development-lifecycle.md', 'agents/build.md']) {
    const text = await readFile(new URL(`../../.opencode/${file}`, import.meta.url), 'utf8');
    assert.ok(text.includes("alters dependency entries in `package-lock.json` (a change to only the root package's `version` fields, as in a release bump, does not)"), file);
  }
});

test('beads-manager Git forms named in its contract are allowed', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const bash = settings.agent['beads-manager'].permission.bash;
  const forms = await contractGitForms('beads-manager');
  assert.deepEqual(forms, ['git rev-parse --path-format=absolute --git-common-dir', 'git worktree list --porcelain']);
  for (const form of forms) assert.equal(bashAction(bash, form), 'allow', form);
});

test('every agent with bd rules has exact help rules for its subcommands, named in its contract', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const expected = {
    plan: ['show', 'ready', 'blocked', 'list'],
    'code-reviewer': ['show', 'dep', 'dep list'],
    'beads-manager': ['show', 'ready', 'list', 'history', 'create', 'update', 'dep', 'dep add', 'dep remove', 'close'],
    'release-manager': ['show', 'blocked', 'dep', 'dep list']
  };
  const withBd = Object.entries(settings.agent).filter(([, agent]) => typeof agent.permission?.bash === 'object' && Object.entries(agent.permission.bash).some(([key, action]) => key.startsWith('command bd -C ') && action !== 'deny'));
  assert.deepEqual(withBd.map(([name]) => name).sort(), Object.keys(expected).sort());
  for (const [name, agent] of withBd) {
    const bash = agent.permission.bash;
    const listed = expected[name];
    const contract = await readFile(new URL(`../../.opencode/agents/${name}.md`, import.meta.url), 'utf8');
    const named = listed.length === 1 ? listed[0] : `${listed.slice(0, -1).join(', ')} or ${listed.at(-1)}`;
    assert.ok(contract.includes(`\`command bd --help\` or \`command bd <subcommand> --help\`, without \`-C\`, for ${named}.`), name);
    const permitted = Object.keys(bash).filter(key => bash[key] !== 'deny').map(key => key.match(/^command bd -C \* (?:--readonly )?(.+) \*$/)?.[1]).filter(Boolean);
    const parents = permitted.filter(sub => sub.includes(' ')).map(sub => sub.split(' ')[0]);
    assert.deepEqual([...new Set([...permitted, ...parents])].sort(), [...listed].sort(), name);
    assert.equal(bashAction(bash, 'command bd --help'), 'allow', name);
    for (const sub of listed) {
      assert.equal(bashAction(bash, `command bd ${sub} --help`), 'allow', `${name} ${sub}`);
      assert.notEqual(bashAction(bash, `command bd -C "/main" ${sub} --help`), 'allow', `${name} ${sub}`);
      assert.notEqual(bashAction(bash, `command bd -C "/main" --readonly ${sub} --help`), 'allow', `${name} ${sub}`);
    }
    // bd close --reason consumes the next argument, so a help wildcard would admit a real close.
    assert.notEqual(bashAction(bash, 'command bd close bbk-x --reason --help'), 'allow', name);
    assert.equal(Object.keys(bash).some(key => key.includes('*') && key.includes('--help')), false, name);
  }
});

test('the lifecycle keeps the stop-on-any-denial, terminal-stop and truncation sentences', async () => {
  const lifecycle = await readFile(new URL('../../.opencode/instructions/development-lifecycle.md', import.meta.url), 'utf8');
  assert.ok(lifecycle.includes('Truncated tool output is not a denial or a failed gate.'));
  assert.ok(lifecycle.includes('A plan may impose stop-on-denial on a named step; that instruction covers every denied call in the step, even when a permitted tool could reach the same result, and makes that denial a terminal stop.'));
  assert.ok(lifecycle.includes('After a terminal stop, issue no further tool calls'));
});

test('every gate-running role may record exact toolchain versions and nothing broader', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const lifecycle = await readFile(new URL('../../.opencode/instructions/development-lifecycle.md', import.meta.url), 'utf8');
  assert.ok(lifecycle.includes('records `node --version`, and `python3 --version` for the Python tooling suite'));
  const maps = Object.entries(settings.agent).filter(([, agent]) => typeof agent.permission?.bash === 'object');
  const gateRoles = maps.filter(([, agent]) => Object.hasOwn(agent.permission.bash, 'npm test')).map(([name]) => name);
  assert.deepEqual(gateRoles.sort(), ['ci-build-engineer', 'release-manager', 'typescript-specialist', 'webview-specialist']);
  for (const [name, agent] of maps) {
    const bash = agent.permission.bash;
    assert.equal(bashAction(bash, 'node --version') === 'allow', gateRoles.includes(name), name);
    assert.equal(bashAction(bash, 'python3 --version') === 'allow', name === 'ci-build-engineer', name);
    for (const extended of ['node --version --eval 1', 'python3 --version -c 1']) assert.notEqual(bashAction(bash, extended), 'allow', `${name} ${extended}`);
  }
  for (const name of ['plan-reviewer', 'code-reviewer', 'test-strategist']) {
    for (const command of ['npm test', 'node --version', 'python3 --version']) assert.equal(bashAction(settings.agent[name].permission.bash, command), 'deny', `${name} ${command}`);
  }
});

test('no agent carries a list permission, which OpenCode 1.18.31 has no tool for', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  assert.equal(Object.hasOwn(settings.permission, 'list'), false);
  for (const [name, agent] of Object.entries(settings.agent)) assert.equal(Object.hasOwn(agent.permission ?? {}, 'list'), false, name);
});

test('every bash map denies a simple-command redirection after its allows, keeping only named ask forms after it', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const after = { 'ci-build-engineer': ['oc-commit *', 'git log -1 *', 'git --no-optional-locks -c core.fsmonitor=false log -1 *', '*agent-wt-merge*--close-beads*'], 'beads-manager': ['command bd -C * create *', 'command bd -C * update *', 'command bd -C * close *', 'command bd -C * worktree create *', 'command bd -C * mol wisp create *', 'command bd -C * protomolecule wisp create *', ...['--global', '--db', '--database'].flatMap(flag => [`bd ${flag}*`, `bd * ${flag}*`, `command bd ${flag}*`, `command bd * ${flag}*`, `*/bd ${flag}*`, `*/bd * ${flag}*`])] };
  for (const [name, agent] of Object.entries(settings.agent)) {
    const bash = agent.permission?.bash;
    if (typeof bash !== 'object') continue;
    const keys = Object.keys(bash);
    const tail = keys.slice(keys.indexOf('*>*') + 1);
    assert.equal(bash['*>*'], 'deny', name);
    assert.deepEqual(tail, after[name] ?? [], name);
    for (const key of tail) assert.equal(bash[key], /--close-beads|worktree create|wisp create|bd (\* )?--(global|db|database)\*/.test(key) ? 'deny' : 'ask', `${name} ${key}`);
    for (const key of keys.filter(key => bash[key] === 'allow')) {
      assert.equal(bashAction(bash, `${key.replaceAll('*', 'x')} > /tmp/out`), 'deny', `${name} ${key}`);
    }
  }
  const ci = settings.agent['ci-build-engineer'].permission.bash;
  assert.equal(bashAction(ci, "git log -1 --format='%an <%ae> | %cn <%ce>'"), 'ask');
  assert.equal(bashAction(ci, "oc-commit -m 'fix: a -> b'"), 'ask');
  assert.equal(bashAction(settings.agent['beads-manager'].permission.bash, `command bd -C "/m" update bbk-x --title='a -> b' --actor OpenCode`), 'ask');
});

test('bash file inspection is denied to default-deny roles, asks elsewhere, and never reaches protected paths', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const lifecycle = await readFile(new URL('../../.opencode/instructions/development-lifecycle.md', import.meta.url), 'utf8');
  assert.ok(lifecycle.includes('Prefer Read, which lists a directory\'s entries when given its path, Glob or Grep for file and directory checks.'));
  for (const [name, agent] of Object.entries(settings.agent)) {
    const bash = agent.permission?.bash ?? settings.permission.bash;
    const resolve = command => typeof bash === 'string' ? bash : bashAction(bash, command);
    const fallback = typeof bash === 'string' ? bash : bash['*'];
    for (const command of ['ls', 'ls -la node_modules', 'wc -l package.json', 'test -f package.json', 'cat package.json', 'head -1 package.json', 'tail -1 package.json', 'find . -name x']) {
      assert.equal(resolve(command), fallback, `${name} ${command}`);
    }
    for (const command of ['cat .env', 'cat ./.env.local', 'head ~/.ssh/id_ed25519', 'cat ~/.local/share/opencode/auth.json', 'ls .beads/dolt', 'cat ~/.npmrc']) {
      assert.equal(resolve(command), 'deny', `${name} ${command}`);
    }
  }
});

test('agent-read Markdown keeps every line well under the 2000-character Read line limit', async () => {
  const { readdir } = await import('node:fs/promises');
  const root = new URL('../../', import.meta.url);
  const files = ['AGENTS.md', 'CLAUDE.md', 'RELEASING.md', 'TESTING.md', 'CONTRIBUTING.md'];
  for (const dir of ['.opencode/agents', '.opencode/instructions', 'docs/development']) {
    for (const name of await readdir(new URL(`${dir}/`, root))) if (name.endsWith('.md')) files.push(`${dir}/${name}`);
  }
  assert.ok(files.length > 15);
  for (const file of files) {
    const lines = (await readFile(new URL(file, root), 'utf8')).split('\n');
    lines.forEach((line, index) => assert.ok(line.length <= 1200, `${file}:${index + 1} has ${line.length} characters`));
  }
});

test('every read-only git rule resolves the same with the no-optional-locks fsmonitor guard prefix', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const guard = 'git --no-optional-locks -c core.fsmonitor=false ';
  const readOnly = /^git (rev-parse|branch|diff|log|ls-files|merge-base|ls-remote|worktree) /;
  let checked = 0;
  for (const [name, agent] of Object.entries(settings.agent)) {
    const bash = agent.permission?.bash;
    if (typeof bash !== 'object') continue;
    const probes = Object.keys(bash).filter(key => bash[key] !== 'deny' && readOnly.test(key) && !key.includes('|')).map(key => key.replaceAll('*', 'x'));
    for (const contract of ['beads-manager', 'code-reviewer', 'release-manager'].includes(name) ? await contractGitForms(name) : []) {
      if (readOnly.test(contract)) probes.push(contract);
    }
    for (const probe of probes) {
      assert.equal(bashAction(bash, guard + probe.slice(4)), bashAction(bash, probe), `${name}: ${probe}`);
      checked++;
    }
  }
  assert.ok(checked > 40);
});

test('every role treats a denied read as class A, and stop-on-denial applies only where a plan names a step', async () => {
  const lifecycle = await readFile(new URL('../../.opencode/instructions/development-lifecycle.md', import.meta.url), 'utf8');
  assert.ok(lifecycle.includes('a rule-based denial of a read is an error, not a stop'));
  assert.ok(lifecycle.includes('Do not resend the same command text or probe which variants are allowed.'));
  assert.ok(lifecycle.includes("return your result as incomplete in your role's format and name what is missing"));
  assert.ok(lifecycle.includes("A denied call aimed at a protected path (`.env*`, `.ssh`, `auth.json`, `.npmrc` or `.beads`), whichever tool's rule denied it, is never pursued through another tool."));
  assert.ok(lifecycle.includes('A denied class B, C or D action is trigger 7, and a human rejecting a call is trigger 6: either is a terminal stop for that dispatch.'));
  assert.ok(lifecycle.includes('Reserve it for steps that can mutate state.'));
  assert.equal(lifecycle.includes('evidence-backed recovery sequence'), false);
  assert.equal(lifecycle.includes('Permission-aware recovery'), false);
  assert.equal(lifecycle.includes('Bootstrap pause'), false);
  assert.equal(lifecycle.includes('may recover once'), false);
  assert.equal(lifecycle.includes('a later call in the same dispatch is denied'), false);
  assert.ok(lifecycle.includes('A denied read is a class A event (the denied-read rule)'));
  for (const file of ['build', 'plan']) {
    const text = await readFile(new URL(`../../.opencode/agents/${file}.md`, import.meta.url), 'utf8');
    assert.ok(text.includes("the lifecycle's denied-read rule"), file);
    assert.equal(text.includes('one-recovery rule'), false, file);
    assert.equal(text.includes('read-only denial rule'), false, file);
  }
});

test('every gitignored credential pattern is also excluded from the VSIX', async () => {
  const gitignore = (await readFile(new URL('../../.gitignore', import.meta.url), 'utf8')).split('\n');
  const vscodeignore = (await readFile(new URL('../../.vscodeignore', import.meta.url), 'utf8')).split('\n').map(line => line.trim()).filter(line => line && !line.startsWith('#'));
  const start = gitignore.indexOf('# Credentials and local environment files');
  assert.ok(start >= 0);
  const patterns = [];
  for (const line of gitignore.slice(start + 1)) {
    if (!line.trim()) break;
    patterns.push(line.trim());
  }
  assert.ok(patterns.length >= 4);
  for (const pattern of patterns) {
    assert.ok(vscodeignore.some(rule => rule.startsWith('**/') && wildcardMatch(pattern, rule.slice(3))), pattern);
  }
});

test('dependency preparation is named in the routing contracts and the project configuration grants it only to CI', async () => {
  const settings = JSON.parse(await readFile(new URL('../../.opencode/opencode.jsonc', import.meta.url), 'utf8'));
  const install = 'npm ci --ignore-scripts';
  for (const file of ['instructions/development-lifecycle.md', 'agents/build.md', 'agents/ci-build-engineer.md']) {
    const text = await readFile(new URL(`../../.opencode/${file}`, import.meta.url), 'utf8');
    assert.ok(text.includes(`\`${install}\``), file);
  }
  const ciContract = await readFile(new URL('../../.opencode/agents/ci-build-engineer.md', import.meta.url), 'utf8');
  for (const check of ['git --no-optional-locks -c core.fsmonitor=false status --porcelain=v1 -uall', 'git diff --no-ext-diff --no-textconv --stat', 'git diff --no-ext-diff --no-textconv']) {
    assert.ok(ciContract.includes(`\`${check}\``), check);
    assert.equal(bashAction(settings.agent['ci-build-engineer'].permission.bash, check), 'allow', check);
  }
  for (const [name, agent] of Object.entries(settings.agent)) {
    const bash = agent.permission?.bash ?? settings.permission.bash;
    if (typeof bash !== 'string') assert.equal(Object.keys(bash)[0], '*', name);
    const action = typeof bash === 'string' ? bash : bashAction(bash, install);
    assert.equal(action, name === 'ci-build-engineer' ? 'ask' : 'deny', name);
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
  for (const key of ['.opencode/opencode.jsonc', '.opencode/permissions/**', '.opencode/agents/**', '.opencode/instructions/**', 'AGENTS.md', 'CLAUDE.md', 'docs/development/opencode-workflow.md', 'docs/development/agent-evaluation.md']) assert.equal(Object.hasOwn(ci.edit, key), false, key);
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
