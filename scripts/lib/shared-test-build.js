'use strict';

const fs = require('fs');
const path = require('path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');

function buildSharedTests(includeTests = true) {
  const cache = path.join(root, 'node_modules/.cache');
  fs.mkdirSync(cache, { recursive: true });
  const output = fs.mkdtempSync(path.join(cache, 'shared-tests-'));
  const tests = includeTests
    ? [...ts.sys.readDirectory(path.join(root, 'src/test/shared'), ['.ts'], undefined, ['**/*.test.ts']),
      path.join(root, 'src/test/suite/treeBuilder.test.ts')]
    : [];
  if (includeTests && tests.length < 2) {
    throw new Error('Expected src/test/shared/*.test.ts and the existing treeBuilder suite');
  }
  const files = [...ts.sys.readDirectory(path.join(root, 'src/shared'), ['.ts']), ...tests];
  const options = {
    target: ts.ScriptTarget.ES2022,
    module: ts.ModuleKind.CommonJS,
    moduleResolution: ts.ModuleResolutionKind.Node10,
    lib: ['lib.es2022.d.ts'],
    types: includeTests ? ['node', 'mocha'] : ['node'],
    strict: true,
    esModuleInterop: true,
    skipLibCheck: true,
    rootDir: path.join(root, 'src'),
    outDir: output,
    noEmitOnError: true
  };
  try {
    const program = ts.createProgram(files, options);
    const emitted = program.emit();
    const diagnostics = [...ts.getPreEmitDiagnostics(program), ...emitted.diagnostics];
    if (diagnostics.length) {
      throw new Error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
        getCanonicalFileName: name => name,
        getCurrentDirectory: () => root,
        getNewLine: () => '\n'
      }));
    }
    return {
      output,
      tests: tests.map(file => path.join(output, path.relative(path.join(root, 'src'), file)).replace(/\.ts$/, '.js')),
      cleanup: () => fs.rmSync(output, { recursive: true, force: true })
    };
  } catch (error) {
    fs.rmSync(output, { recursive: true, force: true });
    throw error;
  }
}

module.exports = { buildSharedTests, root };
