import { build } from 'esbuild';
import { readdirSync, mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

mkdirSync('node_modules/.cache', { recursive: true });
const directory = mkdtempSync('node_modules/.cache/terminal-tests-');
try {
  const names = readdirSync('test').filter(name => /\.test\.tsx?$/.test(name));
  await build({
    entryPoints: names.map(name => join('test', name)), outdir: directory, outbase: 'test',
    outExtension: { '.js': '.mjs' }, bundle: true, platform: 'node', format: 'esm',
    target: 'node22', packages: 'external', sourcemap: 'inline'
  });
  const result = spawnSync(process.execPath, ['--test', ...names.map(name => resolve(directory, name.replace(/\.tsx?$/, '.mjs')))], { stdio: 'inherit' });
  if (result.error) { throw result.error; }
  process.exitCode = result.status ?? 1;
} finally { rmSync(directory, { recursive: true, force: true }); }
