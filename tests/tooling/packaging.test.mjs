import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import processTools from '../../scripts/lib/workflow-process.js';

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

test('actual package listing excludes workflow tooling and retains extension assets and license', async () => {
  const result = await processTools.run(process.execPath, [path.join(root, 'node_modules/@vscode/vsce/vsce'), 'ls', '--no-dependencies'], { cwd: root, timeout: 30000 });
  assert.equal(result.code, 0, 'VSCE listing must succeed');
  const files = result.stdout.trim().split(/\r?\n/);
  for (const name of ['package.json', 'README.md', 'CHANGELOG.md', 'LICENSE', 'out/extension.js', 'out/webview/board.js', 'media/purify.min.js', 'media/marked.min.js', 'images/icon.png']) assert.ok(files.includes(name), name);
  const exact = new Set(['THIRD_PARTY_NOTICES.md', 'LICENSES/dotfiles-workflow-MIT.txt', 'configs/pipeline-guard.json', 'configs/schemas/pipeline-guard.v1.schema.json', ...['agent-wt-merge', 'resolve-python3', 'check-pipeline.py', 'pipeline_guard.py', 'pipeline_policy.py', 'pipeline_runtime.py', 'github_pipeline.py', 'pipeline_evidence.py', 'gitlab_pipeline_runtime.py', 'check-gitlab-pipeline.py'].map(name => `assets/${name}`)]);
  for (const file of files) {
    assert.equal(exact.has(file), false, file);
    assert.equal(/^(?:\.opencode|\.claude|\.github|node_modules|scripts|tests\/tooling|docs\/development|assets\/__pycache__)\//.test(file), false, file);
    assert.equal(/(?:^|\/)\.env/.test(file), false, file);
  }
});
