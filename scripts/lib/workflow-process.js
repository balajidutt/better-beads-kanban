'use strict';

const { spawn } = require('node:child_process');
const path = require('node:path');
const { realpath } = require('node:fs/promises');

class WorkflowError extends Error {
  constructor(code) { super(code); this.code = code; }
}

function gitEnvironment(source = process.env) {
  const env = Object.fromEntries(Object.entries(source).filter(([name]) => !name.startsWith('GIT_')));
  return { ...env, GIT_TERMINAL_PROMPT: '0', GIT_OPTIONAL_LOCKS: '0' };
}

function beadsEnvironment(source = process.env) {
  return Object.fromEntries(Object.entries(gitEnvironment(source)).filter(([name]) => !/^(BEADS_|BD_|DOLT_)/.test(name)));
}

function run(command, args, { cwd, env = process.env, input = '', timeout = 10000, maxBytes = 1048576, signal } = {}) {
  if (!Number.isInteger(timeout) || timeout < 1 || timeout > 30000 || !Number.isInteger(maxBytes) || maxBytes < 1 || maxBytes > 1048576) return Promise.reject(new WorkflowError('INVALID_PROCESS_BOUNDS'));
  if (Buffer.byteLength(input) > maxBytes) return Promise.reject(new WorkflowError('INPUT_LIMIT'));
  if (signal?.aborted) return Promise.reject(new WorkflowError('PROCESS_CANCELLED'));
  return new Promise((resolve, reject) => {
    let child;
    try { child = spawn(command, args, { cwd, env, shell: false, stdio: ['pipe', 'pipe', 'pipe'] }); }
    catch { reject(new WorkflowError('PROCESS_START_FAILED')); return; }
    const stdout = [];
    const stderr = [];
    let bytes = 0;
    let failure;
    let killTimer;
    const stop = code => {
      if (failure) return;
      failure = new WorkflowError(code);
      child.kill('SIGTERM');
      killTimer = setTimeout(() => child.kill('SIGKILL'), 1000);
      killTimer.unref();
    };
    const timer = setTimeout(() => stop('PROCESS_TIMEOUT'), timeout);
    const cancel = () => stop('PROCESS_CANCELLED');
    signal?.addEventListener('abort', cancel, { once: true });
    const collect = output => chunk => {
      bytes += chunk.length;
      if (bytes > maxBytes) { stop('PROCESS_OUTPUT_LIMIT'); return; }
      output.push(chunk);
    };
    child.stdout.on('data', collect(stdout));
    child.stderr.on('data', collect(stderr));
    child.stdin.on('error', () => stop('PROCESS_INPUT_FAILED'));
    child.on('error', error => { failure ??= new WorkflowError(error.code === 'ENOENT' ? 'TOOL_UNAVAILABLE' : 'PROCESS_START_FAILED'); });
    child.on('close', code => {
      clearTimeout(timer);
      clearTimeout(killTimer);
      signal?.removeEventListener('abort', cancel);
      if (failure) reject(failure);
      else resolve({ code, stdout: Buffer.concat(stdout).toString('utf8'), stderr: Buffer.concat(stderr).toString('utf8') });
    });
    child.stdin.end(input);
  });
}

async function git(cwd, args, execute = run) {
  const result = await execute('git', ['-c', 'core.fsmonitor=false', ...args], { cwd, env: gitEnvironment() });
  if (result.code !== 0) throw new WorkflowError('GIT_INSPECTION_FAILED');
  return result.stdout.trim();
}

async function sharedMain(cwd, execute = run) {
  const common = await git(cwd, ['rev-parse', '--path-format=absolute', '--git-common-dir'], execute);
  if (!path.isAbsolute(common) || path.basename(common) !== '.git') throw new WorkflowError('UNSUPPORTED_GIT_LAYOUT');
  const canonical = await realpath(common);
  const main = path.dirname(canonical);
  const checked = await git(main, ['rev-parse', '--path-format=absolute', '--git-common-dir'], execute);
  if (await realpath(checked) !== canonical) throw new WorkflowError('SHARED_MAIN_MISMATCH');
  return { main, common: canonical };
}

function json(text, code = 'INVALID_CLI_JSON') {
  try { return JSON.parse(text); }
  catch { throw new WorkflowError(code); }
}

async function beads(main, args, execute = run, input = '') {
  return execute(process.platform === 'win32' ? 'bd.exe' : 'bd', ['-C', main, '--readonly', ...args], { cwd: main, env: beadsEnvironment(), input });
}

async function assertBeadsTarget(main, execute = run) {
  const result = await beads(main, ['context', '--json'], execute);
  if (result.code !== 0) throw new WorkflowError('BEADS_CONTEXT_UNAVAILABLE');
  const context = json(result.stdout);
  if (typeof context?.beads_dir !== 'string' || !path.isAbsolute(context.beads_dir)
    || path.resolve(context.beads_dir) !== path.join(main, '.beads')) throw new WorkflowError('BEADS_TARGET_MISMATCH');
}

async function readStdin(stream = process.stdin, limit = 1048576) {
  const parts = [];
  let bytes = 0;
  for await (const part of stream) {
    bytes += Buffer.byteLength(part);
    if (bytes > limit) throw new WorkflowError('INPUT_LIMIT');
    parts.push(Buffer.from(part));
  }
  return Buffer.concat(parts).toString('utf8');
}

module.exports = { WorkflowError, run, git, gitEnvironment, beadsEnvironment, beads, assertBeadsTarget, sharedMain, json, readStdin };
