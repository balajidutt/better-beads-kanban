import { defineConfig } from '@vscode/test-cli';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import vscodeTestPaths from './scripts/lib/vscode-test-paths.js';

const projectRoot = dirname(fileURLToPath(import.meta.url));
const userDataDir = vscodeTestPaths.profileDir('vsct', projectRoot);
const cachePath = await vscodeTestPaths.vscodeCachePath(projectRoot);

export default defineConfig({
  tests: [
    {
      label: 'Extension Tests',
      files: 'out/test/suite/**/*.test.js',
      workspaceFolder: '.',
      cachePath,
      launchArgs: ['--disable-extensions', `--user-data-dir=${userDataDir}`],
      mocha: {
        ui: 'tdd',
        timeout: 20000,
        color: true
      }
    }
  ]
});
