import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, readFile, realpath, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import processTools from '../../scripts/lib/workflow-process.js';
import { scratch } from './support/fixtures.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));

test('packaging tool is a locked development dependency with the approved integrity', async () => {
  const pkg = JSON.parse(await readFile(path.join(root, 'package.json'), 'utf8'));
  const lock = JSON.parse(await readFile(path.join(root, 'package-lock.json'), 'utf8'));
  assert.equal(pkg.devDependencies['@vscode/vsce'], '3.6.2');
  assert.equal(pkg.dependencies['@vscode/vsce'], undefined);
  assert.equal(lock.lockfileVersion, 3);
  assert.equal(lock.packages['node_modules/@vscode/vsce'].version, '3.6.2');
  assert.equal(lock.packages['node_modules/@vscode/vsce'].integrity, 'sha512-gvBfarWF+Ii20ESqjA3dpnPJpQJ8fFJYtcWtjwbRADommCzGg1emtmb34E+DKKhECYvaVyAl+TF9lWS/3GSPvg==');
});

test('VSCE ignore rules exclude synthetic environment and auth files and include them when removed', async t => {
  const directory = await scratch(t);
  const { main } = await processTools.sharedMain(root);
  const scratchRoot = await realpath(directory);
  const checkoutRoot = await realpath(root);
  const sharedMainRoot = await realpath(main);
  for (const sourceRoot of [checkoutRoot, sharedMainRoot]) {
    const relative = path.relative(sourceRoot, scratchRoot);
    assert.ok(relative === '..' || relative.startsWith(`..${path.sep}`), 'scratch must be outside both source checkouts');
  }

  await mkdir(path.join(scratchRoot, 'nested'));
  await writeFile(path.join(scratchRoot, 'package.json'), JSON.stringify({
    name: 'vsce-ignore-fixture', version: '1.0.0', publisher: 'fixture', engines: { vscode: '^1.90.0' },
  }));
  await writeFile(path.join(scratchRoot, 'README.md'), 'Inert package listing fixture.\n');
  await writeFile(path.join(scratchRoot, 'LICENSE'), 'Inert fixture license.\n');
  const safeFiles = ['safe.txt', 'nested/safe.txt'];
  const excludedFiles = ['.env', '.env.local', 'config.env', 'auth.json']
    .flatMap(name => [name, `nested/${name}`]);
  for (const file of [...safeFiles, ...excludedFiles]) {
    await writeFile(path.join(scratchRoot, file), 'inert fixture placeholder\n');
  }
  const ignore = await readFile(path.join(root, '.vscodeignore'), 'utf8');
  await writeFile(path.join(scratchRoot, '.vscodeignore'), ignore);

  const list = async () => {
    const result = await processTools.run(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'ls', '--no-dependencies'], { cwd: scratchRoot, timeout: 30000 });
    assert.equal(result.code, 0, 'VSCE listing must succeed');
    assert.ok(result.stdout.trim(), 'VSCE listing must not be empty');
    return new Set(result.stdout.trim().split(/\r?\n/));
  };
  const ignored = await list();
  for (const file of safeFiles) assert.ok(ignored.has(file), `missing safe file: ${file}`);
  for (const file of excludedFiles) assert.equal(ignored.has(file), false, `included excluded file: ${file}`);

  const rules = ['**/.env*', '**/*.env', '**/auth.json'];
  const lines = ignore.split(/\r?\n/);
  for (const rule of rules) assert.equal(lines.filter(line => line === rule).length, 1, `expected one ignore rule: ${rule}`);
  const withoutRules = lines.filter(line => !rules.includes(line));
  assert.equal(lines.length - withoutRules.length, 3, 'exactly three ignore rules must be removed');
  await writeFile(path.join(scratchRoot, '.vscodeignore'), withoutRules.join('\n'));
  const exposed = await list();
  for (const file of excludedFiles) assert.ok(exposed.has(file), `missing mutation-control file: ${file}`);
});

test('actual package listing excludes workflow tooling, shared-core internals and the terminal, and retains extension assets and license', async () => {
  const result = await processTools.run(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'ls', '--no-dependencies'], { cwd: root, timeout: 30000 });
  assert.equal(result.code, 0, 'VSCE listing must succeed');
  const files = result.stdout.trim().split(/\r?\n/);
  for (const name of ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'out/extension.js', 'out/webview/board.js', 'out/webview/graph-layout.js', 'out/webview/graph-view.js', 'media/purify.min.js', 'media/marked.min.js', 'images/icon.png']) assert.ok(files.includes(name), name);
  const runtime = ['out/extension.js', 'out/webview/board.js', 'out/webview/graph-layout.js', 'out/webview/graph-view.js'];
  for (const file of files.filter(name => name.startsWith('out/'))) assert.ok(runtime.includes(file), `unbundled output packaged: ${file}`);
  const exact = new Set(['THIRD_PARTY_NOTICES.md', 'LICENSES/dotfiles-workflow-MIT.txt', 'configs/pipeline-guard.json', 'configs/schemas/pipeline-guard.v1.schema.json', ...['agent-wt-merge', 'resolve-python3', 'check-pipeline.py', 'pipeline_guard.py', 'pipeline_policy.py', 'pipeline_runtime.py', 'github_pipeline.py', 'pipeline_evidence.py', 'gitlab_pipeline_runtime.py', 'check-gitlab-pipeline.py'].map(name => `assets/${name}`)]);
  for (const file of files) {
    assert.equal(exact.has(file), false, file);
    assert.equal(/^(?:\.opencode|\.claude|\.github|node_modules|scripts|tests\/tooling|docs\/development|assets\/__pycache__|terminal|out\/shared)\//.test(file), false, file);
    assert.notEqual(file, 'docs/shared-core.md', file);
    assert.equal(/(?:^|\/)\.env/.test(file), false, file);
    assert.equal(/(?:^|\/)[^/]+\.env$/.test(file), false, file);
    assert.equal(/(?:^|\/)auth\.json$/.test(file), false, file);
  }
});

test('VSCE ignore rules exclude the gate lock bd 1.3 writes beside .beads and include it when removed', async t => {
  const scratchRoot = await realpath(await scratch(t));
  await writeFile(path.join(scratchRoot, 'package.json'), JSON.stringify({
    name: 'vsce-ignore-fixture', version: '1.0.0', publisher: 'fixture', engines: { vscode: '^1.90.0' },
  }));
  await writeFile(path.join(scratchRoot, 'README.md'), 'Inert package listing fixture.\n');
  await writeFile(path.join(scratchRoot, 'LICENSE'), 'Inert fixture license.\n');
  await writeFile(path.join(scratchRoot, '.beads.gate.lock'), '');
  const ignore = await readFile(path.join(root, '.vscodeignore'), 'utf8');
  const list = async rules => {
    await writeFile(path.join(scratchRoot, '.vscodeignore'), rules);
    const result = await processTools.run(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'ls', '--no-dependencies'], { cwd: scratchRoot, timeout: 30000 });
    assert.equal(result.code, 0, 'VSCE listing must succeed');
    return result.stdout.trim().split(/\r?\n/);
  };
  assert.equal((await list(ignore)).includes('.beads.gate.lock'), false);
  const lines = ignore.split(/\r?\n/);
  assert.equal(lines.filter(line => line === '.beads.gate.lock').length, 1);
  assert.ok((await list(lines.filter(line => line !== '.beads.gate.lock').join('\n'))).includes('.beads.gate.lock'));
});

test('VSCE ignore rules package only the four runtime bundles from out/ and include extra output when removed', async t => {
  const scratchRoot = await realpath(await scratch(t));
  await writeFile(path.join(scratchRoot, 'package.json'), JSON.stringify({
    name: 'vsce-ignore-fixture', version: '1.0.0', publisher: 'fixture', engines: { vscode: '^1.90.0' },
  }));
  await writeFile(path.join(scratchRoot, 'README.md'), 'Inert package listing fixture.\n');
  await writeFile(path.join(scratchRoot, 'LICENSE'), 'Inert fixture license.\n');
  const runtime = ['out/extension.js', 'out/webview/board.js', 'out/webview/graph-layout.js', 'out/webview/graph-view.js'];
  const planted = ['out/types.js', 'out/daemonBeadsAdapter.js', 'out/webview/treeBuilder.js', 'out/webview/leaseStatus.js', 'out/shared/node.js', 'out/test/suite/a.test.js', 'out/extension.js.map'];
  for (const file of [...runtime, ...planted]) {
    await mkdir(path.dirname(path.join(scratchRoot, file)), { recursive: true });
    await writeFile(path.join(scratchRoot, file), 'inert fixture output\n');
  }
  const ignore = await readFile(path.join(root, '.vscodeignore'), 'utf8');
  const list = async rules => {
    await writeFile(path.join(scratchRoot, '.vscodeignore'), rules);
    const result = await processTools.run(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'ls', '--no-dependencies'], { cwd: scratchRoot, timeout: 30000 });
    assert.equal(result.code, 0, 'VSCE listing must succeed');
    return result.stdout.trim().split(/\r?\n/).filter(name => name.startsWith('out/')).sort();
  };
  assert.deepEqual(await list(ignore), [...runtime].sort());
  const lines = ignore.split(/\r?\n/);
  assert.equal(lines.filter(line => line === 'out/**').length, 1);
  const exposed = await list(lines.filter(line => line !== 'out/**').join('\n'));
  for (const file of planted.filter(name => !name.endsWith('.map'))) assert.ok(exposed.includes(file), `missing mutation-control file: ${file}`);
});
