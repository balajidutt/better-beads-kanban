'use strict';

const crypto = require('crypto');
const os = require('os');
const path = require('path');

// VS Code's IPC socket lives in --user-data-dir and macOS caps socket paths at 103 chars.
function profileDir(prefix, projectRoot) {
  const hash = crypto.createHash('sha256').update(projectRoot).digest('hex').slice(0, 8);
  return path.join(os.tmpdir(), `${prefix}-${hash}`);
}

module.exports = { profileDir };
