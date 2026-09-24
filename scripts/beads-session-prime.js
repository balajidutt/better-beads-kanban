#!/usr/bin/env node
'use strict';

const path = require('node:path');
const { WorkflowError, run, sharedMain, beads, assertBeadsTarget, json, readStdin } = require('./lib/workflow-process');

async function prime(input, { cwd = process.cwd(), toolingRoot = path.resolve(__dirname, '..'), execute = run } = {}) {
  const payload = input.trim() ? json(input, 'INVALID_HOOK_INPUT') : {};
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new WorkflowError('INVALID_HOOK_INPUT');
  if (payload.cwd !== undefined && (typeof payload.cwd !== 'string' || !path.isAbsolute(payload.cwd))) throw new WorkflowError('INVALID_HOOK_DIRECTORY');
  const requested = await sharedMain(payload.cwd ?? cwd, execute);
  const tooling = await sharedMain(toolingRoot, execute);
  if (requested.common !== tooling.common) throw new WorkflowError('FOREIGN_HOOK_REPOSITORY');
  await assertBeadsTarget(requested.main, execute);
  const result = await beads(requested.main, ['prime', '--hook-json'], execute, input);
  if (result.code !== 0) return { code: result.code || 1, stdout: '', stderr: 'Beads priming unavailable; no initialization or synchronization attempted.\n' };
  json(result.stdout, 'INVALID_HOOK_OUTPUT');
  return { code: 0, stdout: result.stdout, stderr: '' };
}

if (require.main === module) {
  readStdin().then(input => prime(input)).then(result => {
    process.stdout.write(result.stdout);
    process.stderr.write(result.stderr);
    process.exitCode = result.code;
  }, error => {
    process.stderr.write(`Beads priming unavailable: ${error instanceof WorkflowError ? error.code : 'HOOK_FAILED'}.\n`);
    process.exitCode = 1;
  });
}

module.exports = { prime };
