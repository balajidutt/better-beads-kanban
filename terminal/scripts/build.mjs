import { build } from 'esbuild';
await build({
  entryPoints: ['src/cli.tsx'], outfile: 'dist/cli.mjs',
  bundle: true, platform: 'node', format: 'esm', target: 'node22',
  packages: 'external', sourcemap: true
});
