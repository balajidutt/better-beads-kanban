#!/usr/bin/env node
'use strict';

const fs = require('node:fs');
const path = require('node:path');
const name = path.basename(process.argv[1]);
const args = process.argv.slice(2);
const file = process.env.BBK_FIXTURE_STATE;
if (!file) process.exit(97);
const state = JSON.parse(fs.readFileSync(file, 'utf8'));
fs.appendFileSync(state.log, JSON.stringify({ name, args, cwd: process.cwd(), host: process.env.GH_HOST }) + '\n');
const emit = (text, code = 0) => { process.stdout.write(text); process.exit(code); };
const data = value => emit(JSON.stringify(value));
const http = (code, value) => emit(`HTTP/2.0 ${code}\ncontent-type: application/json\n\n${JSON.stringify(value)}`, code === 200 ? 0 : 1);

if (name === 'git') {
  if (args.includes('--git-common-dir')) emit(path.join(state.source, '.git') + '\n');
  if (args.includes('--show-toplevel')) emit(process.cwd() + '\n');
  if (args.includes('HEAD')) emit(state.sha + '\n');
  if (args.includes('ls-files')) emit('tracked\n');
  if (args.includes('status')) {
    const generated = ['better-beads-kanban-9.8.7.vsix', 'SHA256SUMS'].filter(value => fs.existsSync(path.join(process.cwd(), value)));
    emit(args.includes('--ignored=matching') ? generated.map(value => `!! ${value}\0`).join('') : '');
  }
  if (args.includes('cat-file') || args.includes('merge-base')) emit('');
  if (args.includes('show-ref')) emit('', 1);
}
if (name === 'bd' || name === 'bd.exe') {
  if (!args.includes('--readonly') || args[0] !== '-C' || args[1] !== state.source) process.exit(96);
  if (args.includes('context')) data({ beads_dir: path.join(state.source, '.beads') });
  if (args.includes('show')) data([{ id: 'bbk-release', status: 'open', issue_type: 'task' }]);
  if (args.includes('dep')) data([{ id: 'bbk-item', dependency_type: 'blocks' }]);
  if (args.includes('ready')) data(state.notReady ? [] : [{ id: 'bbk-release' }]);
}
if (name === 'gh') {
  if (args[0] === 'auth' && args[1] === 'switch') {
    const user = args[args.indexOf('--user') + 1];
    if (user === 'fixture-user' && state.restoreFailure) emit('', 9);
    state.account = user;
    fs.writeFileSync(file, JSON.stringify(state));
    emit('');
  }
  if (args[0] === 'api' && args[1] === 'user') emit(state.account + '\n');
  if (args[0] === 'release' && args[1] === 'create') emit('synthetic publication\n');
  const endpoint = args.at(-1);
  if (endpoint === 'repos/balajidutt/better-beads-kanban') http(200, { full_name: 'balajidutt/better-beads-kanban' });
  if (endpoint.endsWith('/git/ref/heads/main')) http(200, { ref: 'refs/heads/main', object: { type: 'commit', sha: state.sha } });
  if (endpoint.includes('/tags/')) http(404, { message: 'Not Found' });
}
if (name === 'npm') emit('', state.buildFailure ? 7 : 0);
if (name === 'vsce') {
  if (args[0] !== 'package' || !args.includes('--out')) process.exit(95);
  fs.writeFileSync(path.resolve(args[args.indexOf('--out') + 1]), 'synthetic VSIX bytes');
  emit('synthetic package\n');
}
process.stderr.write('unexpected fixture command\n');
process.exit(98);
