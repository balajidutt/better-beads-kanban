'use strict';

const path = require('path');
const ts = require('typescript');
const esbuild = require('esbuild');
const { root } = require('./lib/shared-test-build');

const src = path.join(root, 'src');
const shared = path.join(src, 'shared');
const model = path.join(shared, 'model.ts');
const nodeEntry = path.join(shared, 'node.ts');
const tree = path.join(shared, 'treeBuilder.ts');
const inside = (dir, file) => !path.relative(dir, file).startsWith('..') && !path.isAbsolute(path.relative(dir, file));
const failures = [];
const options = { moduleResolution: ts.ModuleResolutionKind.Node10 };

function imports(source) {
  const found = [];
  function visit(node) {
    if ((ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) && node.moduleSpecifier) {
      found.push(node.moduleSpecifier);
    } else if (ts.isImportEqualsDeclaration(node) && ts.isExternalModuleReference(node.moduleReference)) {
      found.push(node.moduleReference.expression);
    } else if (ts.isImportTypeNode(node) && ts.isLiteralTypeNode(node.argument)) {
      found.push(node.argument.literal);
    } else if (ts.isCallExpression(node) && (node.expression.kind === ts.SyntaxKind.ImportKeyword ||
      (ts.isIdentifier(node.expression) && node.expression.text === 'require'))) {
      if (node.arguments.length !== 1 || !ts.isStringLiteralLike(node.arguments[0])) {
        failures.push(`${source.fileName}: nonliteral module load cannot be boundary-checked`);
      } else { found.push(node.arguments[0]); }
    }
    ts.forEachChild(node, visit);
  }
  visit(source);
  return found.filter(ts.isStringLiteralLike).map(node => node.text);
}

async function main() {
  const files = ts.sys.readDirectory(src, ['.ts', '.tsx', '.js', '.jsx']);
  for (const file of files) {
    const source = ts.createSourceFile(file, ts.sys.readFile(file), ts.ScriptTarget.Latest, true);
    for (const specifier of imports(source)) {
      const resolved = ts.resolveModuleName(specifier, file, options, ts.sys).resolvedModule?.resolvedFileName;
      if (inside(shared, file) && ((resolved && !inside(shared, resolved) && !resolved.includes(`${path.sep}node_modules${path.sep}`)) || /^(vscode|react|react-dom|ink)(\/|$)/.test(specifier))) {
        failures.push(`${path.relative(root, file)} imports outside shared: ${specifier}`);
      }
      if (!inside(shared, file) && !inside(path.join(src, 'test'), file) && resolved && inside(shared, resolved)) {
        if (resolved !== model && resolved !== nodeEntry) {
          failures.push(`${path.relative(root, file)} imports shared implementation: ${specifier}`);
        }
        if (inside(path.join(src, 'webview'), file) && resolved === nodeEntry) {
          failures.push(`${path.relative(root, file)} imports Node entry from browser code`);
        }
      }
    }
  }
  const browserProgram = ts.createProgram([model, tree], {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.ESNext,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    lib: ['lib.es2022.d.ts'],
    types: [], strict: true, noEmit: true, skipLibCheck: true
  });
  for (const diagnostic of ts.getPreEmitDiagnostics(browserProgram)) {
    failures.push(ts.flattenDiagnosticMessageText(diagnostic.messageText, '\n'));
  }
  for (const source of browserProgram.getSourceFiles().filter(source => inside(shared, source.fileName))) {
    for (const specifier of imports(source)) {
      if (specifier === 'vscode' || specifier.startsWith('node:') || require('module').builtinModules.includes(specifier)) {
        failures.push(`${source.fileName}: browser graph imports ${specifier}`);
      }
    }
  }
  await esbuild.build({
    entryPoints: [model, tree], bundle: true, platform: 'browser', format: 'esm',
    write: false, outdir: 'boundary-check', logLevel: 'silent',
    plugins: [{ name: 'browser-runtime-boundary', setup(build) {
      build.onResolve({ filter: /.*/ }, args => {
        if (args.path === 'vscode' || args.path.startsWith('node:') || require('module').builtinModules.includes(args.path)) {
          return { errors: [{ text: `Browser graph imports forbidden runtime: ${args.path}` }] };
        }
      });
    } }]
  });
  if (failures.length) { throw new Error(failures.join('\n')); }
  console.log('Shared boundaries and browser-safe model/tree graph passed');
}

main().catch(error => { console.error(error.message); process.exitCode = 1; });
