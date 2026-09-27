'use strict';

const crypto = require('crypto');
const { realpath } = require('fs/promises');
const os = require('os');
const path = require('path');
const workflowProcess = require('./workflow-process');

// VS Code's IPC socket lives in --user-data-dir and macOS caps socket paths at 103 chars.
function profileDir(prefix, projectRoot) {
  const hash = crypto.createHash('sha256').update(projectRoot).digest('hex').slice(0, 8);
  return path.join(os.tmpdir(), `${prefix}-${hash}`);
}

async function vscodeCachePath(projectRoot) {
  const fallback = path.join(projectRoot, '.vscode-test');
  try {
    const top = await workflowProcess.git(projectRoot, ['rev-parse', '--path-format=absolute', '--show-toplevel']);
    if (!path.isAbsolute(top) || await realpath(top) !== await realpath(projectRoot)) return fallback;
    const { main } = await workflowProcess.sharedMain(projectRoot);
    return path.join(main, '.vscode-test');
  } catch {
    return fallback;
  }
}

module.exports = { profileDir, vscodeCachePath };
