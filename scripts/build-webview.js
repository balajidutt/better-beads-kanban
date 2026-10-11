const esbuild = require('esbuild');
const path = require('path');
const fs = require('fs');

// Ensure output directory exists
const outDir = path.join(__dirname, '../out/webview');
if (!fs.existsSync(outDir)) {
  fs.mkdirSync(outDir, { recursive: true });
}

// Check if watch mode is enabled
const isWatch = process.argv.includes('--watch');

const bundles = [
  // The main webview JavaScript
  {
    entryPoints: [path.join(__dirname, '../src/webview/board.js')],
    bundle: true,
    outfile: path.join(outDir, 'board.js'),
    platform: 'browser',
    target: ['es2020'],
    format: 'iife',
    minify: false, // Keep readable for debugging in development
    sourcemap: true,
    define: {
      'process.env.NODE_ENV': '"production"'
    },
    logLevel: 'info'
  },
  // The graph layout module
  {
    entryPoints: [path.join(__dirname, '../src/webview/graph-layout.js')],
    bundle: true,
    outfile: path.join(outDir, 'graph-layout.js'),
    platform: 'browser',
    target: ['es2020'],
    format: 'esm',
    minify: false,
    sourcemap: true,
    logLevel: 'info'
  },
  // The graph view module
  {
    entryPoints: [path.join(__dirname, '../src/webview/graph-view.js')],
    bundle: true,
    outfile: path.join(outDir, 'graph-view.js'),
    platform: 'browser',
    target: ['es2020'],
    format: 'esm',
    minify: false,
    sourcemap: true,
    logLevel: 'info'
  }
];

if (isWatch) {
  // Watch mode for development; esbuild logs the "[watch] build ..." lines the F5 problem matcher waits on
  Promise.all(bundles.map(options => esbuild.context(options)))
    .then(contexts => Promise.all(contexts.map(ctx => ctx.watch())))
    .then(() => {
      console.log('👀 Watching webview code for changes...');
    })
    .catch((error) => {
      console.error('✗ Webview watch failed:', error);
      process.exit(1);
    });
} else {
  Promise.all(bundles.map(options => esbuild.build(options)))
    .then(() => {
      console.log('✓ Webview bundles built successfully');
    })
    .catch((error) => {
      console.error('✗ Webview bundle failed:', error);
      process.exit(1);
    });
}
