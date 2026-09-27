'use strict';

const childProcess = require('child_process');
const crypto = require('crypto');
const os = require('os');
const path = require('path');

// VS Code's IPC socket lives in --user-data-dir and macOS caps socket paths at 103 chars.
function profileDir(prefix, projectRoot) {
  const hash = crypto.createHash('sha256').update(projectRoot).digest('hex').slice(0, 8);
  return path.join(os.tmpdir(), `${prefix}-${hash}`);
}

function gitCommonDir(cwd) {
  try {
    return childProcess.execFileSync(
      'git', ['rev-parse', '--path-format=absolute', '--git-common-dir'],
      { cwd, encoding: 'utf8', timeout: 5000, maxBuffer: 64 * 1024, stdio: ['ignore', 'pipe', 'ignore'] }
    ).trim();
  } catch {
    return null;
  }
}

function vscodeCachePath(projectRoot) {
  const commonDir = gitCommonDir(projectRoot);
  return commonDir && path.basename(commonDir) === '.git'
    ? path.join(path.dirname(commonDir), '.vscode-test')
    : path.join(projectRoot, '.vscode-test');
}

module.exports = { profileDir, vscodeCachePath };
