import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { scratch } from './support/fixtures.mjs';

const root = fileURLToPath(new URL('../../', import.meta.url));
const require = createRequire(import.meta.url);
const esbuild = require(path.join(root, 'node_modules', 'esbuild'));
const { problemLines } = require(path.join(root, 'scripts', 'lib', 'esbuild-problem-lines.js'));

async function watchMatchers() {
  const tasks = JSON.parse(await readFile(path.join(root, '.vscode', 'tasks.json'), 'utf8')).tasks;
  return ['watch', 'watch:webview'].map(script => {
    const task = tasks.find(candidate => candidate.type === 'npm' && candidate.script === script);
    assert.ok(task, `npm: ${script} task not found`);
    return { script, matcher: task.problemMatcher };
  });
}

async function reportedLines(t, files) {
  const directory = await scratch(t);
  for (const [name, source] of Object.entries(files)) { await writeFile(path.join(directory, name), source); }
  const lines = [];
  await esbuild.build({
    entryPoints: Object.keys(files).filter(name => name.startsWith('entry')),
    absWorkingDir: directory,
    outdir: path.join(directory, 'out'),
    bundle: true,
    write: false,
    logLevel: 'silent',
    plugins: [problemLines(line => lines.push(line))]
  }).catch(error => {
    if (!Array.isArray(error.errors)) { throw error; }
  });
  return lines;
}

function match(matcher, line) {
  const { pattern } = matcher;
  const groups = new RegExp(pattern.regexp).exec(line);
  if (!groups) { return undefined; }
  return {
    file: groups[pattern.file], line: Number(groups[pattern.line]), column: Number(groups[pattern.column]),
    severity: groups[pattern.severity], message: groups[pattern.message]
  };
}

test('both watch tasks resolve reported paths against the workspace folder', async () => {
  for (const { script, matcher } of await watchMatchers()) {
    assert.deepEqual(matcher.fileLocation, ['relative', '${workspaceFolder}'], script);
  }
});

test('a syntax error reaches both watch matchers with its file, 1-based position and message', async t => {
  const lines = await reportedLines(t, { 'entry.ts': 'const x = ;\n' });
  for (const { script, matcher } of await watchMatchers()) {
    const problems = lines.map(line => match(matcher, line)).filter(Boolean);
    assert.deepEqual(problems, [{ file: 'entry.ts', line: 1, column: 11, severity: 'error', message: 'Unexpected ";"' }], script);
  }
});

test('an unresolved import is reported at the import specifier', async t => {
  const lines = await reportedLines(t, { 'entry.js': 'import y from "./missing";\nconsole.log(y);\n' });
  const [{ matcher }] = await watchMatchers();
  assert.deepEqual(lines.map(line => match(matcher, line)), [
    { file: 'entry.js', line: 1, column: 15, severity: 'error', message: 'Could not resolve "./missing"' }
  ]);
});

test('the column counts characters, not bytes, after non-ASCII text', async t => {
  const lines = await reportedLines(t, { 'entry.js': 'const s = "ééé😀"; const z = ;\n' });
  const [{ matcher }] = await watchMatchers();
  assert.deepEqual(lines.map(line => match(matcher, line)?.column), ['const s = "ééé😀"; const z = '.length + 1]);
});

test('warnings are reported with warning severity', async t => {
  const lines = await reportedLines(t, { 'entry.js': 'if (typeof x === "undefinedd") {}\n' });
  const [{ matcher }] = await watchMatchers();
  const problems = lines.map(line => match(matcher, line));
  assert.ok(problems.length > 0, 'esbuild reported no warning for the fixture');
  assert.ok(problems.every(problem => problem?.severity === 'warning'), JSON.stringify(problems));
});

test('both watch scripts load the plugin in watch mode', async () => {
  for (const script of ['build-extension.js', 'build-webview.js']) {
    const source = await readFile(path.join(root, 'scripts', script), 'utf8');
    assert.match(source, /require\('\.\/lib\/esbuild-problem-lines'\)/, script);
    assert.match(source, /esbuild\.context\(\{ \.\.\.[a-zA-Z]+, plugins: \[problemLines\(\)\] \}\)/, script);
  }
});
