'use strict';

/**
 * Record bd CLI output into src/test/fixtures/bd-<version>/ so the mapper
 * suites can run against real shapes without bd installed.
 *
 * Usage:
 *   BD_BIN=/abs/path/to/bd node scripts/record-bd-fixtures.js
 *
 * Seeds a scratch workspace (scripts/lib/bd-scratch-workspace.js) with a
 * parent and open child, a blocked pair, a claimed issue, a deferred issue and
 * a comment, then captures the commands the extension runs plus the refusals
 * it has to handle. Commands the binary does not support are recorded as
 * failures rather than skipped, so the 1.2.2 set shows what is missing.
 *
 * Output is scrubbed: the workspace path, project id and owner identity become
 * placeholders, and every recording timestamp is shifted so the earliest one
 * lands on FIXED_BASE while the gaps between them are kept. bd runs in UTC so
 * dates written in local time do not carry the recorder's offset.
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

// Set before the helper loads so its init and containment check see the same
// environment: anything here could redirect bd to another database or actor.
for (const key of Object.keys(process.env)) {
  if (/^(BEADS_DIR|BEADS_DB|BEADS_DOLT_|BD_ACTOR|BD_JSON_ENVELOPE|BEADS_MAX_ROWS|BD_EVENTS_JOURNAL)/.test(key)) {
    delete process.env[key];
  }
}
process.env.TZ = 'UTC';
process.env.BEADS_ACTOR = 'fixture-actor';

const { createScratchWorkspace, BD, SPAWN_DEFAULTS } = require('./lib/bd-scratch-workspace');

const FIXED_BASE = Date.parse('2026-01-02T03:04:05Z');
const ISO_TIMESTAMP = /\b(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?Z)\b/g;
const ZERO_TIME = '0001-01-01T00:00:00Z';
const FAR_FUTURE = /^2099-/;
const VERSION = /^\d+\.\d+\.\d+[\w.-]*$/;

function bd(workspace, args, extraEnv = {}) {
  const result = spawnSync(BD, [...workspace.bdArgs, ...args], {
    ...SPAWN_DEFAULTS,
    cwd: workspace.dir,
    env: { ...process.env, ...extraEnv }
  });
  if (result.error) {
    throw new Error(`bd ${args.join(' ')} failed to start: ${result.error.message}`);
  }
  return { args, exitCode: result.status, stdout: result.stdout || '', stderr: result.stderr || '' };
}

function bdOk(workspace, args) {
  const result = bd(workspace, args);
  if (result.exitCode !== 0) {
    throw new Error(`bd ${args.join(' ')} exited ${result.exitCode}: ${result.stderr.trim()}`);
  }
  return result.stdout.trim();
}

function parseJson(text) {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function main() {
  const workspace = createScratchWorkspace('fx');
  const captures = {};
  let realDir = workspace.dir;
  let version;
  try {
    realDir = fs.realpathSync(workspace.dir);
    const versionJson = parseJson(bd(workspace, ['version', '--json']).stdout);
    if (!versionJson || typeof versionJson.version !== 'string' || !VERSION.test(versionJson.version)) {
      throw new Error(`Could not read a version from 'bd version --json' (${BD})`);
    }
    version = versionJson.version;

    const context = parseJson(bd(workspace, ['context', '--json']).stdout) || {};
    if (context.dolt_mode !== 'embedded') {
      throw new Error(`Refusing to record: scratch workspace is in '${context.dolt_mode}' mode, expected embedded`);
    }
    const ids = {};
    ids.parent = bdOk(workspace, ['create', '--title', 'Parent epic', '--type', 'epic', '--silent']);
    ids.child = bdOk(workspace, ['create', '--title', 'Open child', '--parent', ids.parent, '--silent']);
    ids.blocker = bdOk(workspace, ['create', '--title', 'Blocker', '--silent']);
    ids.blocked = bdOk(workspace, ['create', '--title', 'Blocked', '--deps', `blocked-by:${ids.blocker}`, '--silent']);
    ids.claimed = bdOk(workspace, ['create', '--title', 'Claimed', '--silent']);
    bdOk(workspace, ['update', ids.claimed, '--claim']);
    ids.deferred = bdOk(workspace, ['create', '--title', 'Deferred', '--defer', '2099-01-01', '--silent']);
    bdOk(workspace, ['comments', 'add', ids.claimed, 'First comment']);
    const allIds = Object.values(ids);

    captures['version.json'] = versionJson;
    captures['ids.json'] = ids;
    captures['list-all.json'] = bd(workspace, ['list', '--json', '--all', '--limit', '0']);
    captures['list-brief.json'] = bd(workspace, ['list', '--json', '--all', '--limit', '0', '--brief']);
    captures['ready.json'] = bd(workspace, ['ready', '--json', '--limit', '0']);
    captures['show-batch.json'] = bd(workspace, ['show', '--json', ...allIds]);
    captures['show-full.json'] = bd(workspace, ['show', '--json', '--include-comments', '--include-dependents', ...allIds]);
    captures['show-brief-deps.json'] = bd(workspace, ['show', '--json', '--brief-deps', ...allIds]);
    captures['stats.json'] = bd(workspace, ['stats', '--json']);
    captures['comments.json'] = bd(workspace, ['comments', ids.claimed, '--json']);
    captures['context.json'] = bd(workspace, ['context', '--json']);

    captures['close-refused-children.json'] = bd(workspace, ['update', ids.parent, '--status', 'closed']);
    captures['close-refused-blocker.json'] = bd(workspace, ['update', ids.blocked, '--status', 'closed']);
    captures['if-status-mismatch.json'] = bd(workspace, ['update', ids.blocker, '--status', 'in_progress', '--if-status', 'blocked', '--json']);
    captures['unclaim-not-holder.json'] = bd(workspace, ['unclaim', ids.claimed], { BEADS_ACTOR: 'someone-else' });
    captures['max-rows.json'] = bd(workspace, ['list', '--json', '--all', '--limit', '0'], { BEADS_MAX_ROWS: '2' });

    captures['events-journal-config.json'] = bd(workspace, ['config', 'set', 'events-journal', 'true']);
    bdOk(workspace, ['update', ids.blocker, '--priority', '1']);
    bdOk(workspace, ['comments', 'add', ids.blocker, 'Journal comment']);
    captures['events-tail.jsonl'] = bd(workspace, ['events', 'tail', '--since', '0']);
    bd(workspace, ['config', 'set', 'events-journal-retain-days', '0']);
    bd(workspace, ['config', 'set', 'events-journal-retain-rows', '0']);
    captures['events-prune.json'] = bd(workspace, ['events', 'prune', '--before', '2']);
    captures['events-tail-truncated.json'] = bd(workspace, ['events', 'tail', '--since', '0', '--json']);

    captures['local-version.json'] = {
      written: fs.existsSync(path.join(workspace.dir, '.beads', '.local_version')),
      value: readOptional(path.join(workspace.dir, '.beads', '.local_version'))
    };
  } finally {
    workspace.destroy();
  }

  const outDir = path.join(__dirname, '..', 'src', 'test', 'fixtures', `bd-${version}`);
  const scrub = makeScrubber([realDir, workspace.dir], captures);
  fs.rmSync(outDir, { recursive: true, force: true });
  fs.mkdirSync(outDir, { recursive: true });
  for (const [name, capture] of Object.entries(captures)) {
    fs.writeFileSync(path.join(outDir, fileName(name, capture)), scrub(render(name, capture)));
  }
  console.log(`Recorded ${Object.keys(captures).length} fixtures for bd ${version} in ${path.relative(process.cwd(), outDir)}`);
}

function readOptional(file) {
  try {
    return fs.readFileSync(file, 'utf8').trim();
  } catch {
    return null;
  }
}

/** A failed .jsonl capture is a single JSON object, so it is written as .json. */
function fileName(name, capture) {
  return name.endsWith('.jsonl') && capture.exitCode !== 0 ? name.replace(/\.jsonl$/, '.json') : name;
}

function render(name, capture) {
  if (!capture || capture.exitCode === undefined) {
    return `${JSON.stringify(capture, null, 2)}\n`;
  }
  if (name.endsWith('.jsonl') && capture.exitCode === 0) {
    return capture.stdout.endsWith('\n') ? capture.stdout : `${capture.stdout}\n`;
  }
  const parsed = parseJson(capture.stdout);
  if (capture.exitCode === 0 && parsed !== undefined) {
    return `${JSON.stringify(parsed, null, 2)}\n`;
  }
  return `${JSON.stringify({
    args: capture.args,
    exitCode: capture.exitCode,
    stdout: parsed !== undefined ? parsed : capture.stdout,
    stderr: capture.stderr
  }, null, 2)}\n`;
}

function makeScrubber(workspaceDirs, captures) {
  const dirs = [...new Set(workspaceDirs)].sort((a, b) => b.length - a.length);

  const identities = new Set();
  const projectIds = new Set();
  const visit = value => {
    if (Array.isArray(value)) {
      value.forEach(visit);
    } else if (value && typeof value === 'object') {
      for (const [key, inner] of Object.entries(value)) {
        if (key === 'owner' && typeof inner === 'string' && inner.length >= 3) { identities.add(inner); }
        if (key === 'project_id' && typeof inner === 'string') { projectIds.add(inner); }
        visit(inner);
      }
    }
  };
  for (const capture of Object.values(captures)) {
    visit(capture);
    if (capture && typeof capture.stdout === 'string') {
      visit(parseJson(capture.stdout));
      for (const line of capture.stdout.split('\n')) { visit(parseJson(line)); }
    }
  }

  const allText = Object.values(captures).map(c => JSON.stringify(c)).join('\n');
  const times = [...new Set(allText.match(ISO_TIMESTAMP) || [])]
    .filter(t => t !== ZERO_TIME && !FAR_FUTURE.test(t));
  const earliest = Math.min(...times.map(t => Date.parse(t)));

  return text => {
    let out = text;
    for (const dir of dirs) { out = out.split(dir).join('<WORKSPACE>'); }
    out = out.split(process.cwd()).join('<REPO>');
    for (const identity of identities) { out = out.split(identity).join('fixture-owner@example.com'); }
    for (const id of projectIds) { out = out.split(id).join('00000000-0000-4000-8000-000000000000'); }
    if (Number.isFinite(earliest)) {
      out = out.replace(ISO_TIMESTAMP, t => {
        if (t === ZERO_TIME || FAR_FUTURE.test(t)) { return t; }
        return new Date(FIXED_BASE + (Date.parse(t) - earliest)).toISOString().replace('.000Z', 'Z');
      });
    }
    return out;
  };
}

main();
