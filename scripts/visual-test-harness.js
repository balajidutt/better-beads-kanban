#!/usr/bin/env node

/**
 * Visual Test Harness for Beads Kanban
 *
 * Launches VS Code with the Beads Kanban extension loaded and remote debugging
 * enabled on port 9222, so Chrome DevTools MCP (or any CDP client) can connect
 * to the webview for automated visual testing.
 *
 * Usage:
 *   node scripts/visual-test-harness.js [workspace-path] [--port=9222] [--seed-db]
 *
 * Options:
 *   workspace-path   Path to a folder with .beads data (default: temp dir with seeded DB)
 *   --port=NNNN      Chrome DevTools Protocol port (default: 9222)
 *   --seed-db        Force-create a seeded .beads database in the workspace
 *   --no-seed        Skip database seeding even for temp workspaces
 *   --timeout=MS     Exit after MS milliseconds (0 = no timeout, default: 0)
 *   --webview-timeout=MS
 *                    How long to wait for the board webview target
 *                    (default: 180000; capped by --timeout when that is set)
 *
 * Prerequisites:
 *   npm run compile   (must be run first to build the extension)
 *   bd on PATH        (seeding only; without it the board launches empty)
 *
 * How it works:
 *   1. Downloads/reuses a VS Code instance via @vscode/test-electron
 *   2. Creates a temp workspace with seeded .beads data (if needed)
 *   3. Launches VS Code with --remote-debugging-port for CDP access
 *   4. Loads a tiny "test runner" that executes beadsKanban.openBoard
 *   5. Polls http://localhost:<port>/json until the webview target appears
 *   6. Prints connection info and stays alive for interactive testing
 *
 * Note: This script uses child_process.spawn (not exec) to launch VS Code.
 * All arguments are passed as array elements, not interpolated into a shell
 * string, so there is no command-injection risk.
 */

const path = require('path');
const fs = require('fs');
const http = require('http');
const os = require('os');
const childProcess = require('child_process');
const vscodeTestPaths = require('./lib/vscode-test-paths');

// ---------------------------------------------------------------------------
// Argument parsing
// ---------------------------------------------------------------------------
const cliArgs = process.argv.slice(2);

function getArg(name, defaultVal) {
  const prefix = `--${name}=`;
  const found = cliArgs.find(a => a.startsWith(prefix));
  if (found) { return found.slice(prefix.length); }
  return defaultVal;
}
function hasFlag(name) { return cliArgs.includes(`--${name}`); }
function positional() { return cliArgs.find(a => !a.startsWith('--')); }

const DEBUG_PORT = parseInt(getArg('port', '9222'), 10);
const TIMEOUT_MS = parseInt(getArg('timeout', '0'), 10);
const WEBVIEW_WAIT_MS = parseInt(getArg('webview-timeout', '180000'), 10);
const SEED_DB = hasFlag('seed-db');
const NO_SEED = hasFlag('no-seed');
const WORKSPACE_ARG = positional();

const PROJECT_ROOT = path.resolve(__dirname, '..');

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** HTTP GET that returns a promise of the response body (string). */
function httpGet(url, timeoutMs) {
  if (timeoutMs === undefined) { timeoutMs = 3000; }
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: timeoutMs }, (res) => {
      let data = '';
      res.on('data', chunk => { data += chunk; });
      res.on('end', () => resolve(data));
    });
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('timeout')); });
  });
}

/** Sleep for ms milliseconds. */
function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

/**
 * Seed a workspace with a bd database for visual testing.
 *
 * Everything goes through the bd CLI. bd 1.x dropped the SQLite backend in
 * favour of Dolt, so writing tables directly - as this function used to -
 * produces a file the extension can never read: the board comes up empty while
 * seeding reports success.
 *
 * Degrades gracefully. If bd is missing or a command fails, warn and return
 * null so VS Code still launches; the board will just be empty.
 */
function seedDatabase(workspacePath) {
  const beadsDir = path.join(workspacePath, '.beads');
  if (fs.existsSync(beadsDir)) {
    console.log('  Database already exists: ' + beadsDir);
    return beadsDir;
  }

  // Run bd in the workspace. bd finds .beads by walking up from cwd.
  function bd(args) {
    const result = childProcess.spawnSync('bd', args, {
      cwd: workspacePath,
      encoding: 'utf8'
    });
    if (result.error) { throw result.error; }
    if (result.status !== 0) {
      throw new Error('bd ' + args[0] + ' failed: ' + (result.stderr || result.stdout || '').trim());
    }
    return (result.stdout || '').trim();
  }

  // title, description, type, priority, assignee, labels, status
  const sampleIssues = [
    ['Setup CI/CD pipeline', 'Configure GitHub Actions for automated testing', 'task', '1', 'alice', 'devops', null],
    ['Add dark mode support', 'Implement dark theme using CSS variables', 'feature', '2', 'bob', 'frontend,ui', null],
    ['Fix login redirect bug', 'Users are not redirected after login on mobile', 'bug', '0', 'charlie', 'bug,mobile', null],
    ['Refactor database layer', 'Extract database calls into repository pattern', 'task', '2', 'alice', 'backend', 'in_progress'],
    ['Implement search API', 'Full-text search endpoint for issues', 'feature', '1', 'bob', 'backend,api', 'in_progress'],
    ['Update dependencies', 'Bump all npm packages to latest', 'chore', '3', null, null, 'in_progress'],
    ['Design system audit', 'Review and document all UI components', 'task', '2', 'diana', 'frontend', 'blocked'],
    ['Performance optimization', 'Reduce bundle size below 500KB', 'task', '1', 'charlie', 'performance', 'blocked'],
    ['Write unit tests', 'Achieve 80% code coverage', 'task', '2', 'alice', null, 'closed'],
    ['Initial project setup', 'Create repo, configure tooling', 'task', '1', 'bob', null, 'closed'],
    ['Fix typo in README', 'Correct spelling in installation section', 'bug', '4', null, null, 'closed'],
    ['Add export feature', 'Export board data as CSV', 'feature', '2', 'diana', 'feature', null]
  ];

  try {
    // --prefix is explicit because bd otherwise derives it from the directory
    // name, and these workspaces are named beads-kanban-visual-XXXXXX.
    bd(['init', '--non-interactive', '--quiet', '--prefix', 'vt']);

    // bd assigns the IDs, so keep the ones we need for relationships below.
    const ids = [];
    for (const issue of sampleIssues) {
      const args = [
        'create', '--silent',
        '--title', issue[0],
        '--description', issue[1],
        '--type', issue[2],
        '--priority', issue[3]
      ];
      if (issue[4]) { args.push('--assignee', issue[4]); }
      if (issue[5]) { args.push('--labels', issue[5]); }
      ids.push(bd(args));
    }

    // bd create has no --status flag, so statuses are a second pass.
    sampleIssues.forEach(function(issue, i) {
      if (issue[6]) { bd(['update', ids[i], '--status', issue[6]]); }
    });

    // "Design system audit" is blocked by "Refactor database layer".
    bd(['dep', 'add', ids[6], '--blocked-by', ids[3]]);

    bd(['comment', ids[2], 'Reproduced on iOS Safari. Investigating.']);

    console.log('  Seeded database with ' + sampleIssues.length + ' issues at: ' + beadsDir);
    return beadsDir;

  } catch (err) {
    console.warn('  Warning: Could not seed database (' + err.message + ')');
    if (/store is read-only/.test(err.message)) {
      console.warn('  bd treats a store inside a forked git repo as read-only when');
      console.warn('  routing.contributor is set. Use the default temp workspace, or');
      console.warn('  pass a workspace path outside any fork.');
    }
    console.warn('  The extension will still launch but may show "no database found".');
    return null;
  }
}

/**
 * Write the harness test runner to a temp file.
 * This is the script VS Code loads via --extensionTestsPath.
 * It opens the Kanban board command and then keeps VS Code alive.
 */
function writeHarnessRunner(runnerDir) {
  if (!fs.existsSync(runnerDir)) {
    fs.mkdirSync(runnerDir, { recursive: true });
  }
  const runnerPath = path.join(runnerDir, 'index.js');
  const runnerCode = [
    '// Visual Test Harness Runner',
    '// Loaded by VS Code as the "test" entry point. Opens the Kanban board',
    '// and then blocks forever so VS Code stays open for interactive testing.',
    '',
    'const vscode = require("vscode");',
    '',
    'exports.run = function run() {',
    '  return new Promise(function(_resolve, _reject) {',
    '    // Give the extension a moment to activate, then open the board',
    '    setTimeout(async function() {',
    '      try {',
    '        console.log("[visual-harness] Executing beadsKanban.openBoard...");',
    '        await vscode.commands.executeCommand("beadsKanban.openBoard");',
    '        console.log("[visual-harness] Kanban board opened successfully.");',
    '      } catch (err) {',
    '        console.error("[visual-harness] Failed to open board:", err);',
    '        // Do not reject -- we still want VS Code to stay open',
    '      }',
    '    }, 3000);',
    '',
    '    // Never resolve: keeps VS Code running until the user closes it or',
    '    // the outer process sends SIGINT/SIGTERM.',
    '  });',
    '};',
  ].join('\n');
  fs.writeFileSync(runnerPath, runnerCode);
  return runnerPath;
}

/**
 * Poll the CDP /json endpoint until a webview target appears.
 * Returns the target info object, or null on timeout.
 */
async function waitForWebview(port, maxWaitMs) {
  if (maxWaitMs === undefined) { maxWaitMs = 180000; }
  const startTime = Date.now();
  const interval = 2000;

  while (Date.now() - startTime < maxWaitMs) {
    try {
      const raw = await httpGet('http://localhost:' + port + '/json');
      const targets = JSON.parse(raw);

      // Only the vscode-webview:// scheme identifies a webview. Title matching
      // is not safe here: the workbench target's title is its vscode-file:// URL,
      // which contains the checkout path - and this repo is called Beads-Kanban.
      // Matching on 'beads' or 'kanban' therefore hit the workbench on the first
      // poll, returned the wrong target instantly, and meant the wait below never
      // actually ran.
      //
      // Note the webview is reported with type 'iframe', not 'page', so do not
      // filter on type either.
      const webviewTarget = targets.find(function(t) {
        return t.url && t.url.indexOf('vscode-webview://') === 0;
      });

      if (webviewTarget) {
        return webviewTarget;
      }

    } catch (_e) {
      // Port not ready yet
    }

    await sleep(interval);
  }

  return null;
}

/**
 * Wait for the debug port to accept connections.
 */
async function waitForDebugPort(port, maxWaitMs) {
  if (maxWaitMs === undefined) { maxWaitMs = 30000; }
  const startTime = Date.now();
  while (Date.now() - startTime < maxWaitMs) {
    try {
      const raw = await httpGet('http://localhost:' + port + '/json/version');
      JSON.parse(raw);
      return true;
    } catch (_e) {
      // not ready
    }
    await sleep(1000);
  }
  return false;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------
async function main() {
  console.log('======================================================================');
  console.log('  Beads Kanban - Visual Test Harness');
  console.log('======================================================================');
  console.log('');

  // -----------------------------------------------------------------------
  // 1. Determine workspace
  // -----------------------------------------------------------------------
  var workspacePath;
  var tempDir = null;

  if (WORKSPACE_ARG) {
    workspacePath = path.resolve(WORKSPACE_ARG);
    if (!fs.existsSync(workspacePath)) {
      console.error('ERROR: Workspace path does not exist: ' + workspacePath);
      process.exit(1);
    }
    console.log('Workspace: ' + workspacePath);
    if (SEED_DB) {
      seedDatabase(workspacePath);
    }
  } else {
    // Create a temp workspace with seeded data
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'beads-kanban-visual-'));
    workspacePath = tempDir;
    console.log('Workspace: ' + workspacePath + ' (temporary)');
    if (!NO_SEED) {
      seedDatabase(workspacePath);
    }
  }

  // -----------------------------------------------------------------------
  // 2. Write the harness test runner
  // -----------------------------------------------------------------------
  var runnerDir = path.join(tempDir || os.tmpdir(), 'visual-harness-runner');
  writeHarnessRunner(runnerDir);
  console.log('Runner:    ' + runnerDir);
  console.log('Port:      ' + DEBUG_PORT);
  console.log('');

  // -----------------------------------------------------------------------
  // 3. Download/locate VS Code and launch
  // -----------------------------------------------------------------------
  var testElectron = require('@vscode/test-electron');
  var downloadAndUnzipVSCode = testElectron.downloadAndUnzipVSCode;

  console.log('Downloading/locating VS Code...');
  var vscodeExecutablePath = await downloadAndUnzipVSCode({
    version: 'stable',
    cachePath: vscodeTestPaths.vscodeCachePath(PROJECT_ROOT)
  });
  console.log('VS Code:   ' + vscodeExecutablePath);
  console.log('');

  // Use the executable directly (Code.exe on Windows, code on others).
  // resolveCliArgsFromVSCodeExecutablePath returns the CLI wrapper (code.cmd)
  // which exits immediately -- we need the actual Electron binary so the
  // process stays alive and we can monitor its lifecycle.
  var executable = vscodeExecutablePath;

  var userDataDir = vscodeTestPaths.profileDir('vsch', PROJECT_ROOT);
  var extensionsDir = path.join(PROJECT_ROOT, '.vscode-test', 'extensions');

  var launchArgs = [
    workspacePath,
    '--extensionDevelopmentPath=' + PROJECT_ROOT,
    '--extensionTestsPath=' + runnerDir,
    '--remote-debugging-port=' + DEBUG_PORT,
    '--user-data-dir=' + userDataDir,
    '--extensions-dir=' + extensionsDir,
    '--no-sandbox',
    '--disable-gpu-sandbox',
    '--disable-updates',
    '--skip-welcome',
    '--skip-release-notes',
    '--disable-workspace-trust',
    '--disable-extensions',  // Disable all OTHER extensions for clean testing
  ];

  console.log('Launching VS Code with remote debugging...');
  console.log('  Executable: ' + executable);
  console.log('  Key args: --remote-debugging-port=' + DEBUG_PORT);
  console.log('');

  // On Windows, spawn with shell:true and quote the executable path.
  // On other platforms, spawn directly without shell.
  var useShell = process.platform === 'win32';
  var vsCodeProcess = childProcess.spawn(
    useShell ? ('"' + executable + '"') : executable,
    launchArgs,
    {
      env: Object.assign({}, process.env),
      shell: useShell,
      stdio: ['ignore', 'pipe', 'pipe'],
    }
  );

  // Forward VS Code output (selective)
  vsCodeProcess.stdout.on('data', function(data) {
    var lines = data.toString().split('\n').filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      console.log('  [vscode] ' + lines[i]);
    }
  });

  vsCodeProcess.stderr.on('data', function(data) {
    var lines = data.toString().split('\n').filter(Boolean);
    for (var i = 0; i < lines.length; i++) {
      if (lines[i].includes('DevTools listening') ||
          lines[i].includes('Extension host') ||
          lines[i].includes('visual-harness')) {
        console.log('  [vscode] ' + lines[i]);
      }
    }
  });

  // -----------------------------------------------------------------------
  // 4. Wait for debug port
  // -----------------------------------------------------------------------
  console.log('Waiting for debug port ' + DEBUG_PORT + '...');
  var portReady = await waitForDebugPort(DEBUG_PORT);
  if (!portReady) {
    console.error('ERROR: Debug port did not become available within 30 seconds.');
    console.error('       VS Code may have failed to launch. Check the output above.');
    vsCodeProcess.kill();
    process.exit(1);
  }
  console.log('  Debug port is ready.');
  console.log('');

  // -----------------------------------------------------------------------
  // 5. Wait for webview target
  // -----------------------------------------------------------------------
  // Waiting longer than the harness's own lifetime is pointless.
  var webviewWaitMs = WEBVIEW_WAIT_MS;
  if (TIMEOUT_MS > 0 && TIMEOUT_MS < webviewWaitMs) { webviewWaitMs = TIMEOUT_MS; }

  console.log('Waiting for Kanban board webview target (up to ' + Math.round(webviewWaitMs / 1000) + 's)...');
  console.log('  (VS Code has to boot, activate the extension and open the board.');
  console.log('   Measured at ~65s on a cold profile - override with --webview-timeout=MS)');
  var webviewTarget = await waitForWebview(DEBUG_PORT, webviewWaitMs);

  // List all available targets for diagnostics
  var allTargets = [];
  var workbenchTarget = null;
  try {
    var raw = await httpGet('http://localhost:' + DEBUG_PORT + '/json');
    allTargets = JSON.parse(raw);
    console.log('');
    console.log('  All CDP targets (' + allTargets.length + '):');
    for (var i = 0; i < allTargets.length; i++) {
      var t = allTargets[i];
      var marker = '';
      // Compare by id, not identity: this listing re-fetches /json, so the
      // objects are freshly parsed and never identical to the polled one.
      if (webviewTarget && t.id === webviewTarget.id) {
        marker = ' <-- WEBVIEW';
      } else if (t.type === 'page' && t.url && t.url.includes('workbench.html')) {
        workbenchTarget = t;
        marker = ' <-- WORKBENCH';
      }
      console.log('    [' + (t.type || '?') + '] ' + (t.title || '(untitled)') + ' - ' + (t.url || '').substring(0, 80) + marker);
    }
  } catch (_e) {
    // ignore
  }

  // If no explicit webview target found, the workbench target is also useful --
  // Chrome DevTools MCP can interact with VS Code's entire UI through it,
  // including any open webview panels rendered inside the workbench.
  var primaryTarget = webviewTarget || workbenchTarget;

  // -----------------------------------------------------------------------
  // 6. Print connection info
  // -----------------------------------------------------------------------
  console.log('');
  console.log('======================================================================');
  if (webviewTarget) {
    console.log('  Visual Test Harness Ready');
    console.log('');
    console.log('  Chrome DevTools Protocol: http://localhost:' + DEBUG_PORT);
    console.log('  Webview Target:           ' + (webviewTarget.title || webviewTarget.url));
    console.log('  Webview WS URL:           ' + (webviewTarget.webSocketDebuggerUrl || 'N/A'));
  } else if (workbenchTarget) {
    console.log('  Visual Test Harness Ready');
    console.log('');
    console.log('  Chrome DevTools Protocol: http://localhost:' + DEBUG_PORT);
    console.log('  Workbench Target:         ' + (workbenchTarget.title || '(VS Code Workbench)'));
    console.log('  Workbench WS URL:         ' + (workbenchTarget.webSocketDebuggerUrl || 'N/A'));
    console.log('');
    console.log('  Note: The Kanban board webview is rendered inside the workbench.');
    console.log('  Chrome DevTools MCP can interact with it through the workbench target.');
    console.log('  If the board opened, look for its iframe in the DOM.');
  } else {
    console.log('  Visual Test Harness Ready (no targets detected yet)');
    console.log('');
    console.log('  Chrome DevTools Protocol: http://localhost:' + DEBUG_PORT);
    console.log('');
    console.log('  The webview was not automatically detected. This can happen if:');
    console.log('    - The bd CLI is not on PATH (extension needs it for data)');
    console.log('    - The board has not been opened yet');
    console.log('');
    console.log('  Try opening manually: Ctrl+Shift+P -> "Beads: Open Kanban Board"');
    console.log('  Then check targets:   curl http://localhost:' + DEBUG_PORT + '/json');
  }
  console.log('');
  console.log('  Connect Chrome DevTools MCP:');
  console.log('    npx @anthropic-ai/chrome-devtools-mcp@latest --port=' + DEBUG_PORT);
  console.log('');
  console.log('  Or add to Claude Code:');
  console.log('    claude mcp add chrome-devtools -- npx @anthropic-ai/chrome-devtools-mcp@latest --port=' + DEBUG_PORT);
  console.log('');
  console.log('  Browse all targets:');
  console.log('    curl http://localhost:' + DEBUG_PORT + '/json');
  console.log('');
  console.log('  Press Ctrl+C to stop.');
  console.log('======================================================================');

  // -----------------------------------------------------------------------
  // 7. Handle cleanup
  // -----------------------------------------------------------------------
  var exiting = false;

  function cleanup(signal) {
    if (exiting) { return; }
    exiting = true;
    console.log('');
    console.log('  Received ' + signal + '. Shutting down...');

    // Kill VS Code process
    try {
      if (process.platform === 'win32') {
        // On Windows, use taskkill to ensure the entire process tree is killed
        childProcess.spawn('taskkill', ['/pid', String(vsCodeProcess.pid), '/T', '/F'], {
          shell: true,
          stdio: 'ignore'
        });
      } else {
        vsCodeProcess.kill('SIGTERM');
      }
    } catch (_e) {
      // ignore
    }

    // Clean up temp directory
    if (tempDir) {
      try {
        fs.rmSync(tempDir, { recursive: true, force: true });
        console.log('  Cleaned up temp workspace: ' + tempDir);
      } catch (_e) {
        // ignore
      }
    }

    // Clean up runner directory (if workspace was user-provided)
    if (!tempDir) {
      try {
        fs.rmSync(runnerDir, { recursive: true, force: true });
      } catch (_e) {
        // ignore
      }
    }

    // Give taskkill a moment, then exit
    setTimeout(function() { process.exit(0); }, 500);
  }

  process.on('SIGINT', function() { cleanup('SIGINT'); });
  process.on('SIGTERM', function() { cleanup('SIGTERM'); });

  vsCodeProcess.on('exit', function(code, signal) {
    if (!exiting) {
      console.log('');
      console.log('  VS Code exited (code=' + code + ', signal=' + signal + ').');
      cleanup('VS Code exit');
    }
  });

  // Optional timeout
  if (TIMEOUT_MS > 0) {
    setTimeout(function() {
      console.log('');
      console.log('  Timeout reached (' + TIMEOUT_MS + 'ms). Shutting down.');
      cleanup('timeout');
    }, TIMEOUT_MS);
  }
}

main().catch(function(err) {
  console.error('Fatal error:', err);
  process.exit(1);
});
