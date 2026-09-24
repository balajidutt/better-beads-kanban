#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { lstat, readFile, realpath } = require('node:fs/promises');
const { isDeepStrictEqual } = require('node:util');
const { WorkflowError, run, git, gitEnvironment, beads, assertBeadsTarget, sharedMain, json } = require('./lib/workflow-process');

const REPOSITORY = 'balajidutt/better-beads-kanban';
const VERSION = /^[0-9]+\.[0-9]+\.[0-9]+(?:-bd\.[0-9]+)?$/;
const SHA = /^[0-9a-f]{40}$/;
const TOOLING_FILES = ['scripts/release-fork-vsix.sh', 'scripts/release-preflight.js', 'scripts/lib/workflow-process.js'];

async function textFile(root, relative) {
  const file = path.join(root, relative);
  let parent = path.dirname(file);
  while (parent !== root) {
    const entry = await lstat(parent);
    if (!entry.isDirectory() || entry.isSymbolicLink()) throw new WorkflowError('UNSAFE_METADATA_FILE');
    parent = path.dirname(parent);
  }
  const stat = await lstat(file);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.size > 1048576) throw new WorkflowError('UNSAFE_METADATA_FILE');
  return readFile(file, 'utf8');
}

async function github(endpoint, execute, cwd, missing = false) {
  const result = await execute('gh', ['api', '--hostname', 'github.com', '--include', `repos/${REPOSITORY}${endpoint}`], { cwd });
  const text = result.stdout.replace(/\r\n/g, '\n');
  const boundary = text.indexOf('\n\n');
  const status = /^HTTP\/[^\s]+\s+(\d{3})(?:\s|$)/.exec(text)?.[1];
  if (boundary < 0 || !status) throw new WorkflowError('GITHUB_RESPONSE_INVALID');
  const payload = json(text.slice(boundary + 2), 'GITHUB_RESPONSE_INVALID');
  if (status === '404' && missing && result.code !== 0) return null;
  if (result.code !== 0 || status !== '200') throw new WorkflowError('GITHUB_QUERY_FAILED');
  return payload;
}

async function bdJson(main, args, execute) {
  const result = await beads(main, args, execute);
  if (result.code !== 0) throw new WorkflowError('BEADS_QUERY_FAILED');
  return json(result.stdout);
}

async function status(cwd, execute) {
  const result = await execute('git', ['-c', 'core.fsmonitor=false', 'status', '--porcelain=v1', '-z', '--untracked-files=all', '--ignored=matching'], { cwd, env: gitEnvironment() });
  if (result.code !== 0) throw new WorkflowError('GIT_INSPECTION_FAILED');
  return result.stdout.split('\0').filter(Boolean).map(record => {
    if (!/^(!!|\?\?) /.test(record)) throw new WorkflowError('SOURCE_DIRTY');
    return { ignored: record.startsWith('!!'), file: record.slice(3) };
  });
}

async function preflight({ issue, source = process.cwd(), tooling = path.resolve(__dirname, '..'), expected = null, execute = run }) {
  if (typeof issue !== 'string' || !issue || issue.length > 256 || /[\s\0]/.test(issue)) throw new WorkflowError('INVALID_RELEASE_ISSUE');
  if (expected !== null && (!expected || typeof expected !== 'object' || Array.isArray(expected) || expected.schemaVersion !== 1)) throw new WorkflowError('INVALID_SNAPSHOT');
  source = await realpath(source);
  tooling = await realpath(tooling);
  const sourceRoot = await realpath(await git(source, ['rev-parse', '--show-toplevel'], execute));
  const toolingRoot = await realpath(await git(tooling, ['rev-parse', '--show-toplevel'], execute));
  if (source !== sourceRoot || tooling !== toolingRoot) throw new WorkflowError('REPOSITORY_ROOT_REQUIRED');
  const sourceGit = await sharedMain(source, execute);
  const toolingGit = await sharedMain(tooling, execute);
  if (sourceGit.common !== toolingGit.common) throw new WorkflowError('TOOLING_SOURCE_MISMATCH');
  for (const name of TOOLING_FILES) await textFile(tooling, name);
  await git(tooling, ['ls-files', '--error-unmatch', '--', ...TOOLING_FILES], execute);
  const toolingState = await git(tooling, ['status', '--porcelain=v1', '--untracked-files=all', '--', ...TOOLING_FILES], execute);
  if (toolingState) throw new WorkflowError('TOOLING_DIRTY');
  const toolingSha = await git(tooling, ['rev-parse', 'HEAD'], execute);
  const sourceSha = await git(source, ['rev-parse', 'HEAD'], execute);
  if (!SHA.test(toolingSha) || !SHA.test(sourceSha)) throw new WorkflowError('SOURCE_SHA_INVALID');

  const pkg = json(await textFile(source, 'package.json'), 'PACKAGE_INVALID');
  if (!VERSION.test(pkg.version ?? '') || !/^[a-z][a-z0-9._-]{0,213}$/.test(pkg.name ?? '') || typeof pkg.displayName !== 'string' || /[\r\n\0]/.test(pkg.displayName)) throw new WorkflowError('PACKAGE_INVALID');
  const webview = await textFile(source, 'src/webview.ts');
  const versions = [...webview.matchAll(/\bconst\s+version\s*=\s*(['"])([^'"\r\n]+)\1/g)];
  if (versions.length !== 1 || versions[0][2] !== pkg.version) throw new WorkflowError('WEBVIEW_VERSION_MISMATCH');
  const changelog = await textFile(source, 'CHANGELOG.md');
  const heading = `## [${pkg.version}]`;
  if (!changelog.split(/\r?\n/).some(line => line === heading || line.startsWith(`${heading} - `))) throw new WorkflowError('CHANGELOG_VERSION_MISMATCH');
  const asset = `${pkg.name}-${pkg.version}.vsix`;
  const tag = `v${pkg.version}`;
  const states = await status(source, execute);
  if (tooling !== source && (await status(tooling, execute)).some(item => !item.ignored)) throw new WorkflowError('TOOLING_DIRTY');
  const generated = new Set([asset, 'SHA256SUMS', 'out/', 'node_modules/', '.vscode-test/', 'media/purify.min.js']);
  if (states.some(item => !item.ignored && !(expected && [asset, 'SHA256SUMS'].includes(item.file)))) throw new WorkflowError('SOURCE_DIRTY');
  if (expected) {
    if (!Array.isArray(expected.ignoredBefore) || states.some(item => item.ignored && !expected.ignoredBefore.includes(item.file) && !generated.has(item.file))) throw new WorkflowError('UNEXPECTED_BUILD_OUTPUT');
  } else {
    for (const name of [asset, 'SHA256SUMS']) {
      try { await lstat(path.join(source, name)); throw new WorkflowError('OUTPUT_COLLISION'); }
      catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
  }

  await assertBeadsTarget(sourceGit.main, execute);
  const issues = await bdJson(sourceGit.main, ['show', '--json', '--', issue], execute);
  if (!Array.isArray(issues) || issues.length !== 1 || issues[0].id !== issue || issues[0].status !== 'open' || issues[0].issue_type !== 'task') throw new WorkflowError('RELEASE_TASK_NOT_OPEN');
  const dependencies = await bdJson(sourceGit.main, ['dep', 'list', '--type', 'blocks', '--json', '--', issue], execute);
  if (!Array.isArray(dependencies) || !dependencies.length || dependencies.some(item => typeof item.id !== 'string' || !item.id || item.dependency_type !== 'blocks')) throw new WorkflowError('RELEASE_SCOPE_INVALID');
  const scope = [...new Set(dependencies.map(item => item.id))].sort();
  if (scope.length !== dependencies.length) throw new WorkflowError('RELEASE_SCOPE_INVALID');
  const ready = await bdJson(sourceGit.main, ['ready', '--json', '--limit', '0'], execute);
  if (!Array.isArray(ready) || !ready.some(item => item.id === issue)) throw new WorkflowError('RELEASE_TASK_NOT_READY');

  const repository = await github('', execute, source);
  if (repository?.full_name?.toLowerCase() !== REPOSITORY) throw new WorkflowError('GITHUB_REPOSITORY_MISMATCH');
  const remote = await github('/git/ref/heads/main', execute, source);
  const remoteMain = remote?.object?.sha;
  if (remote?.ref !== 'refs/heads/main' || remote?.object?.type !== 'commit' || !SHA.test(remoteMain ?? '')) throw new WorkflowError('REMOTE_MAIN_INVALID');
  await git(source, ['cat-file', '-e', `${remoteMain}^{commit}`], execute);
  const ancestor = await execute('git', ['merge-base', '--is-ancestor', sourceSha, remoteMain], { cwd: source, env: gitEnvironment() });
  if (ancestor.code !== 0) throw new WorkflowError('SOURCE_NOT_PROVEN_ON_REMOTE_MAIN');
  const localTag = await execute('git', ['show-ref', '--verify', '--quiet', `refs/tags/${tag}`], { cwd: source, env: gitEnvironment() });
  if (localTag.code === 0) throw new WorkflowError('TAG_ALREADY_EXISTS');
  if (localTag.code !== 1) throw new WorkflowError('TAG_INSPECTION_FAILED');
  if (await github(`/git/ref/tags/${tag}`, execute, source, true)) throw new WorkflowError('TAG_ALREADY_EXISTS');
  if (await github(`/releases/tags/${tag}`, execute, source, true)) throw new WorkflowError('RELEASE_ALREADY_EXISTS');

  const snapshot = { schemaVersion: 1, repository: REPOSITORY, source, tooling, sourceSha, toolingSha, issue, scope, version: pkg.version, name: pkg.name, displayName: pkg.displayName, asset, tag };
  if (expected) {
    const { ignoredBefore, remoteMain: _oldRemote, ...prepared } = expected;
    if (!isDeepStrictEqual(snapshot, prepared)) throw new WorkflowError('RELEASE_SNAPSHOT_CHANGED');
    snapshot.ignoredBefore = ignoredBefore;
  } else snapshot.ignoredBefore = states.filter(item => item.ignored).map(item => item.file).sort();
  snapshot.remoteMain = remoteMain;
  if (Buffer.byteLength(JSON.stringify(snapshot)) > 65536) throw new WorkflowError('SNAPSHOT_LIMIT');
  return snapshot;
}

function argumentsFor(argv) {
  const result = {};
  for (let index = 0; index < argv.length; index += 2) {
    const flag = argv[index];
    const value = argv[index + 1];
    if (!['--release-issue', '--expected-snapshot'].includes(flag) || value === undefined || Object.hasOwn(result, flag)) throw new WorkflowError('INVALID_ARGUMENTS');
    result[flag] = value;
  }
  return { issue: result['--release-issue'], expected: Object.hasOwn(result, '--expected-snapshot') ? json(result['--expected-snapshot'], 'INVALID_SNAPSHOT') : null };
}

if (require.main === module) {
  Promise.resolve().then(() => preflight(argumentsFor(process.argv.slice(2)))).then(snapshot => {
    process.stdout.write(`${JSON.stringify(snapshot)}\n`);
  }, error => {
    process.stderr.write(`Release preflight blocked: ${error instanceof WorkflowError ? error.code : 'PREFLIGHT_FAILED'}.\n`);
    process.exitCode = 1;
  });
}

module.exports = { preflight, argumentsFor, REPOSITORY };
