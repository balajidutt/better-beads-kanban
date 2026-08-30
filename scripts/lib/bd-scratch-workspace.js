'use strict';

/**
 * Throwaway bd workspace for the integration scripts.
 *
 * The scripts below this helper create, update and delete issues. Without a
 * workspace of their own they resolve the database from the process working
 * directory, which is this repo, and the test issues land in the real backlog.
 *
 * Usage:
 *   const { createScratchWorkspace } = require('./lib/bd-scratch-workspace');
 *   const workspace = createScratchWorkspace('bdcli');
 *   spawnSync(BD, [...workspace.bdArgs, 'create', '--title', 'x']);
 */

const { spawnSync } = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

const BD = process.env.BD_BIN || 'bd';

const SPAWN_DEFAULTS = {
  encoding: 'utf8',
  shell: false,
  timeout: 30000,
  maxBuffer: 50 * 1024 * 1024
};

function run(args, options = {}) {
  const result = spawnSync(BD, args, { ...SPAWN_DEFAULTS, ...options });

  if (result.error && result.error.code === 'ENOENT') {
    throw new Error(
      `Could not run '${BD}'. The integration scripts need the bd CLI on PATH; ` +
      `set BD_BIN to an absolute path if it lives somewhere else.`
    );
  }
  if (result.error) {
    throw new Error(`bd ${args.join(' ')} failed to start: ${result.error.message}`);
  }

  return result;
}

function runOrThrow(args, options = {}) {
  const result = run(args, options);
  if (result.status !== 0) {
    const stderr = (result.stderr || '').trim();
    throw new Error(`bd ${args.join(' ')} exited ${result.status}${stderr ? `: ${stderr}` : ''}`);
  }
  return result;
}

/**
 * True when `child` is `parent` or sits underneath it.
 *
 * Both sides go through realpath first. On macOS the OS temp directory is
 * reached via /var, a symlink to /private/var, and bd reports the resolved
 * form -- comparing the two unresolved would say "not contained" for a
 * directory that plainly is. realpath is identity on Linux and in a container.
 * path.relative rather than a string prefix, so a sibling directory whose name
 * merely starts with the parent's does not pass.
 */
function isContained(parent, child) {
  const real = p => fs.realpathSync(path.resolve(p));
  const rel = path.relative(real(parent), real(child));
  return rel === '' || (!rel.startsWith('..') && !path.isAbsolute(rel));
}

function pinRoutingMode(dir) {
  // routing.contributor defaults to ~/.beads-planning and routing.mode has no
  // default at all, so an unpinned workspace can route writes to a database
  // that is neither this one nor the repo's. `bd init --role maintainer` does
  // not settle it: bd still reports role=contributor afterwards. routing.mode
  // is a YAML-only key, so the config file is the layer that decides.
  const configPath = path.join(dir, '.beads', 'config.yaml');
  fs.appendFileSync(configPath, '\nrouting:\n    mode: maintainer\n', 'utf8');

  const mode = runOrThrow(['-C', dir, 'config', 'get', 'routing.mode']).stdout.trim();
  if (mode !== 'maintainer') {
    throw new Error(`Scratch workspace routing.mode is '${mode}', expected 'maintainer'`);
  }
}

function assertIsolated(dir) {
  const context = JSON.parse(runOrThrow(['-C', dir, 'context', '--json']).stdout);
  const beadsDir = context.beads_dir;

  if (!beadsDir || !isContained(dir, beadsDir)) {
    throw new Error(
      `Scratch workspace resolved to ${beadsDir || '(nothing)'}, which is outside ${dir}. ` +
      `Refusing to run: writes would land in another database.`
    );
  }
}

const WORKSPACE_NAME = /^bbk-test-/;
const OWNER_FILE = '.owner-pid';

function isProcessAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (error) {
    return error.code === 'EPERM';
  }
}

/**
 * Delete scratch workspaces left behind by earlier runs.
 *
 * The scripts using this helper are a straight line of synchronous spawnSync
 * calls, so Node never reaches the event loop to run a signal handler while one
 * is in flight. SIGKILL, and a Ctrl-C that does not also take down the bd
 * child, both leave the directory behind. Sweeping on the way in means a leak
 * costs one stale directory until the next run rather than accumulating.
 *
 * Workspaces owned by a live process are left alone, so running two of these
 * scripts at once does not have one delete the other's database mid-run.
 */
function sweepStaleWorkspaces() {
  const tmp = os.tmpdir();

  let entries;
  try {
    entries = fs.readdirSync(tmp);
  } catch {
    return;
  }

  for (const entry of entries) {
    if (!WORKSPACE_NAME.test(entry)) {
      continue;
    }

    const dir = path.join(tmp, entry);
    try {
      const owner = Number(fs.readFileSync(path.join(dir, OWNER_FILE), 'utf8').trim());
      if (Number.isInteger(owner) && isProcessAlive(owner)) {
        continue;
      }
    } catch {
      // No owner recorded: the run died before it got that far, so it is stale.
    }

    try {
      fs.rmSync(dir, { recursive: true, force: true });
    } catch {
      // Left for the next run rather than failing this one.
    }
  }
}

/**
 * @param {string} prefix Issue prefix for the scratch database, e.g. 'bdcli'.
 * @returns {{dir: string, bdArgs: string[], destroy: () => void}}
 */
function createScratchWorkspace(prefix) {
  sweepStaleWorkspaces();

  const dir = fs.mkdtempSync(path.join(os.tmpdir(), `bbk-test-${prefix}-`));
  fs.writeFileSync(path.join(dir, OWNER_FILE), String(process.pid), 'utf8');

  let destroyed = false;

  const destroy = () => {
    if (destroyed) {
      return;
    }
    destroyed = true;
    fs.rmSync(dir, { recursive: true, force: true });
  };

  // Registered before init so a failure part way through still cleans up.
  process.on('exit', destroy);
  for (const signal of ['SIGINT', 'SIGTERM']) {
    process.on(signal, () => {
      destroy();
      process.exit(signal === 'SIGINT' ? 130 : 143);
    });
  }

  try {
    // `bd -C <dir> init` refuses with "no beads project found" -- -C wants a
    // workspace that already exists, which is what init is for. cwd instead.
    runOrThrow(
      ['init', '--non-interactive', '--prefix', prefix, '--skip-agents', '--skip-hooks', '--quiet'],
      { cwd: dir, timeout: 120000 }
    );
    pinRoutingMode(dir);
    assertIsolated(dir);
  } catch (error) {
    destroy();
    throw error;
  }

  return { dir, bdArgs: ['-C', dir], destroy };
}

module.exports = { createScratchWorkspace, BD, SPAWN_DEFAULTS };
