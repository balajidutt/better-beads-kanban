import assert from 'node:assert/strict';
import { build } from 'esbuild';
import { mkdirSync, mkdtempSync, readFileSync, writeFileSync, rmSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';
import { performance } from 'node:perf_hooks';
import scratch from '../../scripts/lib/bd-scratch-workspace.js';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const safety = ['--readonly', '--sandbox', '--dolt-auto-commit', 'off'];

export async function buildHarness() {
  const cache = join(root, 'node_modules/.cache');
  mkdirSync(cache, { recursive: true });
  const directory = mkdtempSync(join(cache, 'terminal-integration-'));
  try {
    await build({
      entryPoints: ['runtime', 'controller', 'clipboard'].map(name => join(root, 'src', `${name}.ts`)),
      outdir: directory, outExtension: { '.js': '.mjs' }, bundle: true,
      platform: 'node', format: 'esm', target: 'node22', packages: 'external', sourcemap: 'inline',
    });
    const modules = await Promise.all(['runtime', 'controller', 'clipboard']
      .map(name => import(pathToFileURL(join(directory, `${name}.mjs`)).href)));
    return { ...Object.assign({}, ...modules), cleanup: () => rmSync(directory, { recursive: true, force: true }) };
  } catch (error) {
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
}

export async function settle(controller) {
  const deadline = performance.now() + 60000;
  while (controller.getState().loading || controller.getState().detailLoading) {
    assert.ok(performance.now() < deadline, 'Controller did not settle within 60 seconds');
    await new Promise(resolve => setTimeout(resolve, 5));
  }
  assert.equal(controller.getState().error, null);
  assert.equal(controller.getState().detailError, null);
}

export function auditSummary(events) {
  let live = 0;
  let maxLive = 0;
  const starts = new Map();
  const listMs = [];
  for (const event of events) {
    if (event.event === 'start') {
      starts.set(event.pid, event);
      maxLive = Math.max(maxLive, ++live);
      const args = event.args;
      if (args[0] === 'version') { assert.deepEqual(args, ['version', '--json']); }
      else {
        assert.deepEqual(args.slice(-4), safety);
        const read = args.slice(0, -4);
        if (read[0] === 'context') { assert.deepEqual(read, ['context', '--json']); }
        else if (read[0] === 'list') {
          assert.deepEqual(read.slice(0, 4), ['list', '--json', '--all', '--limit']);
          assert.equal(read.length, 5);
          assert.match(read[4], /^\d+$/u);
        } else {
          assert.equal(read[0], 'show', 'Runtime must issue only allowed reads');
          assert.equal(read.length, 3);
          assert.equal(read[1], '--json');
          assert.match(read[2], /^[a-zA-Z0-9][a-zA-Z0-9._-]*$/u);
        }
      }
    } else {
      const start = starts.get(event.pid);
      assert.ok(start, 'Every process end needs a start');
      assert.equal(event.code, 0);
      if (start.args[0] === 'list') { listMs.push(event.ms); }
      live--;
    }
  }
  assert.equal(live, 0, 'All audited bd processes must exit');
  return { maxLiveBdProcesses: maxLive, listMs,
    commands: events.filter(event => event.event === 'start').map(event => event.args) };
}

export async function runReal(harness) {
  const workspace = scratch.createScratchWorkspace('terminal');
  let controller;
  let service;
  const setup = (...args) => {
    const result = spawnSync(scratch.BD, [...workspace.bdArgs, '--sandbox', ...args], {
      ...scratch.SPAWN_DEFAULTS, cwd: workspace.dir,
    });
    if (result.error || result.status !== 0) {
      throw new Error(`Fixture ${args[0]} failed: ${result.error?.message || result.stderr}`);
    }
    return result.stdout.trim();
  };
  try {
    const create = (title, ...args) => setup('create', '--title', title, '--silent', ...args);
    const parent = create('Parent', '--type', 'epic');
    const blocker = create('Blocker');
    const description = 'Description café\n\n**Markdown** $HOME';
    const child = create('Open with blocker', '--parent', parent, '--description', description,
      '--labels', 'terminal-fixture,searchable', '--design', 'Design text', '--acceptance', 'Acceptance text', '--notes', 'Notes text');
    setup('dep', 'add', child, blocker);
    setup('comments', 'add', child, 'Fixture comment');
    const closedParent = create('Closed parent', '--type', 'epic');
    setup('close', closedParent, '--reason', 'Fixture');
    const activeChild = create('Active child', '--parent', closedParent);
    const unknown = spawnSync(scratch.BD, [...workspace.bdArgs, '--sandbox', 'update', blocker, '--status', 'terminal_custom'], {
      ...scratch.SPAWN_DEFAULTS, cwd: workspace.dir,
    });
    if (unknown.error) { throw unknown.error; }
    if (unknown.status !== 0) {
      assert.match(unknown.stderr, /invalid status|unknown status|not.*valid.*status/iu);
      console.log('bd rejects custom status; benchmark supplies synthetic unfamiliar statuses.');
    } else {
      assert.equal(JSON.parse(setup('show', blocker, '--json'))[0].status, 'terminal_custom');
    }
    const auditPath = join(workspace.dir, 'runtime-audit.jsonl');
    const wrapper = join(workspace.dir, 'bd-audit.mjs');
    writeFileSync(auditPath, '');
    writeFileSync(wrapper, `#!${process.execPath}\nimport { appendFileSync } from 'node:fs';
import { spawn } from 'node:child_process';
const args = process.argv.slice(2);
const log = value => appendFileSync(${JSON.stringify(auditPath)}, JSON.stringify({pid: process.pid, ...value}) + '\\n');
const started = performance.now();
log({event: 'start', args});
const child = spawn(${JSON.stringify(scratch.BD)}, args, {shell: false, stdio: 'inherit'});
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => child.kill(signal));
child.on('error', error => { console.error(error); process.exitCode = 1; });
child.on('close', code => { log({event: 'end', code, ms: performance.now() - started}); process.exitCode = code ?? 1; });
`, { mode: 0o755 });
    const events = () => readFileSync(auditPath, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line));
    const commands = () => events().filter(event => event.event === 'start').map(event => event.args);
    const started = await harness.createReadService({ repo: workspace.dir, bdPath: wrapper, limit: 100, clipboard: 'manual' });
    service = started.service;
    let liveDetails = 0;
    let maxDetails = 0;
    controller = new harness.BrowserController({ ...service, async detail(id) {
      maxDetails = Math.max(maxDetails, ++liveDetails);
      try { return await service.detail(id); } finally { liveDetails--; }
    } }, 100);
    await controller.refresh();
    await settle(controller);
    assert.equal(controller.getState().view, 'tree');
    assert.deepEqual(commands().map(args => args[0]), ['version', 'context', 'list', 'show']);
    assert.equal(commands()[2][4], '101');
    assert.equal(commands()[3][2], controller.getState().selectedId);
    assert.equal(controller.getState().cards.length, 5);
    const card = id => controller.getState().cards.find(value => value.id === id);
    assert.equal(card(child).parent.id, parent);
    assert.equal(card(child).status, 'open');
    assert.ok(card(child).blocked_by.some(value => value.id === blocker));
    assert.equal(card(closedParent).status, 'closed');
    assert.equal(card(activeChild).parent.id, closedParent);
    assert.ok(controller.project().rows.some(row => row.card.id === closedParent && !row.matches));
    controller.select(child);
    await settle(controller);
    assert.equal(controller.getState().detail.description, description);
    assert.deepEqual([...controller.getState().detail.labels].sort(), ['searchable', 'terminal-fixture']);
    for (const [field, value] of [['design', 'Design text'], ['acceptance_criteria', 'Acceptance text'], ['notes', 'Notes text']]) {
      assert.equal(controller.getState().detail[field], value);
    }
    const before = commands().length;
    for (const view of ['table', 'kanban', 'tree']) {
      controller.setView(view);
      assert.equal(controller.getState().selectedId, child);
      assert.equal(controller.getState().detail.id, child);
      assert.equal(commands().length, before);
    }
    assert.ok(controller.project().columns.find(column => column.status === 'open').cards.some(value => value.id === child));
    controller.setFilters({ search: 'searchable' });
    assert.deepEqual(controller.project().matching.map(value => value.id), [child]);
    controller.resetFilters();
    let copied;
    assert.equal(await harness.copyId(child, 'osc52', { write: value => { copied = value; } }), 'OSC 52 clipboard request sent');
    assert.equal(copied, `\x1b]52;c;${Buffer.from(child).toString('base64')}\x07`);
    assert.equal(commands().length, before);
    controller.select(parent);
    await settle(controller);
    const expandedBefore = commands().length;
    controller.toggle();
    controller.toggle();
    controller.select(child);
    await settle(controller);
    assert.equal(commands().length, expandedBefore, 'Expansion and cached selection must not read');
    setup('update', child, '--description', 'Externally refreshed description');
    const refreshBefore = commands().length;
    await controller.refresh();
    await settle(controller);
    assert.equal(controller.getState().selectedId, child);
    assert.equal(controller.getState().detail.description, 'Externally refreshed description');
    assert.deepEqual(commands().slice(refreshBefore).map(args => args[0]), ['list', 'show']);
    controller.dispose();
    const cappedBefore = commands().length;
    const capped = await harness.createReadService({ repo: workspace.dir, bdPath: wrapper, limit: 2, clipboard: 'manual' });
    service = capped.service;
    controller = new harness.BrowserController(service, 2);
    await controller.refresh();
    await settle(controller);
    assert.equal(controller.getState().cards.length, 2);
    assert.equal(controller.getState().truncated, true);
    assert.equal(commands().slice(cappedBefore).find(args => args[0] === 'list')[4], '3');
    const summary = auditSummary(events());
    assert.equal(summary.maxLiveBdProcesses, 1);
    assert.equal(maxDetails, 1);
    const report = { platform: process.platform, node: process.version, bd: started.version,
      ...summary, maxLiveControllerDetails: maxDetails, heapUsedBytes: process.memoryUsage().heapUsed };
    console.log(JSON.stringify({ realIntegration: report }, null, 2));
    return report;
  } catch (error) {
    const diagnostics = [['context', '--json'], ['list', '--json', '--all', '--limit', '6']];
    if (controller?.getState().selectedId) {
      diagnostics.push(['show', '--json', controller.getState().selectedId]);
    }
    for (const args of diagnostics) {
      try { console.error(`Actual scratch bd ${args[0]} response: ${setup(...args)}`); }
      catch (diagnostic) { console.error(diagnostic.message); }
    }
    throw error;
  } finally {
    controller?.dispose();
    service?.dispose();
    workspace.destroy();
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const harness = await buildHarness();
  try { await runReal(harness); }
  finally { harness.cleanup(); }
}
