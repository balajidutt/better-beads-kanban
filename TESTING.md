# Testing Documentation

This document describes the testing infrastructure for the Better Beads Kanban VS Code extension.

## Table of Contents

- [Extension Test Suite](#extension-test-suite)
- [Writing a Test](#writing-a-test)
- [Integration Tests](#integration-tests)
- [Visual Testing](#visual-testing)
- [The Extension Development Host](#the-extension-development-host)
- [Manual QA Before a Release](#manual-qa-before-a-release)
- [Continuous Improvement](#continuous-improvement)

## Extension Test Suite

### Independent shared-core checks (Phase A)

After `npm ci`, run:

```bash
npm run test:shared:boundaries
npm run test:shared
npm run test:shared:integration
```

`test:shared` compiles `src/shared`, `src/test/shared/*.test.ts` and the existing
treeBuilder suite into a disposable directory, then runs plain Node/Mocha. It does
not launch VS Code or install DOM mocks. `test:shared:boundaries` checks resolved
imports and the browser-safe model/tree graph with TypeScript and esbuild.

The real-bd command is mandatory: missing bd fails rather than skips. Set `BD_BIN`
to an absolute executable path if needed. It reuses
`scripts/lib/bd-scratch-workspace.js`, which creates a temporary database, pins
maintainer routing, verifies containment and cleans up. All fixture writes target
that scratch workspace. Reads exercise the shared public Node entry with sandbox
and read-only flags with Dolt auto-commit off. Fixtures cover parent/child and blocking edges, a closed parent
with an active child, labels, comments and full text fields.

bd 1.2.2 `show --json` omits comment bodies and reverse-edge `dependents` on the
tested builds. Fixture setup verifies the seeded comment through `bd comments`;
the measured reader still issues only list/show. Integration asserts empty mapped
arrays when those fields are absent and reports that limitation. Golden unit tests
cover supplied comments/dependents. List snapshot relationships remain available;
the reader does not fetch missing detail fields through additional commands.

CI has a dedicated Ubuntu job with a checksum-verified prebuilt bd 1.2.2. The
original extension OS/Node matrix still runs independently. See
[`docs/shared-core.md`](docs/shared-core.md) for the provisional architecture and
Checkpoint A packaging decision.

### Independent terminal checks (Phase B)

The private `terminal/` package has its own Node 22+ ESM dependencies, lockfile,
lint, typecheck, tests and build. It is excluded from root TypeScript compilation
and VSIX packaging. Run from the repository root:

```bash
npm --prefix terminal ci --ignore-scripts
npm --prefix terminal run typecheck
npm --prefix terminal run lint
npm --prefix terminal test
npm --prefix terminal run build
```

In disposable Linux, run the built-artifact PTY checks with Python 3, plus real-bd
integration and benchmarks:

```bash
npm --prefix terminal run test:pty
npm --prefix terminal run test:integration
npm --prefix terminal run benchmark
```

The PTY harness uses Python's standard library and temporary fake CLI fixtures.
Real integration reuses the scratch-workspace containment helper; missing bd
fails. Fixture writes are separate from audited runtime commands. The dedicated
terminal CI job installs a checksum-verified bd 1.2.2 and executes these checks;
the root extension matrix remains unchanged. The root shared-boundary command
also checks terminal application imports. Never install native PTY development
tools on macOS for this project.

See [`terminal/README.md`](terminal/README.md) for recorded results, launch
instructions, measured limits and the separate Checkpoint B manual checklist.
Automated PTY/input tests do not establish real clipboard or human acceptance.

### Phase A manual smoke checklist

Run in an Extension Development Host against a disposable populated workspace:

- Open the board and compare issue counts, statuses and labels with bd list.
- Open details; verify description, design, acceptance criteria, notes and comments.
- Verify both directions of parent/child and blocks/blocked-by relationships.
- Switch table, kanban, tree and graph views; confirm a closed parent does not hide
  its active child under the established tree filtering behavior.
- Change a fixture with bd and verify refresh/watch behavior.
- Exercise pagination and repository selection; verify subsequent reads use the
  selected root and current bd executable setting.
- Change tree filters and expansion, switch views and reopen the board; verify
  expansion persistence and loaded-ancestor context.
- Verify read-only configuration and the existing write workflow in the scratch
  workspace; verify errors remain visible for a missing bd executable.

These are manual checks, not assertions that a smoke run has been performed.

`npm test` runs the VS Code extension tests via `@vscode/test-cli`, which downloads a
real VS Code build and runs the suites under `out/test/suite/`.

`npm run verify` is the full gate — `tsc --noEmit`, then `eslint`, then the suite. That
is what `scripts/release-fork-vsix.sh` runs before packaging, so it is the thing to run
before claiming work is done.

### Why `--user-data-dir` points outside the project

`.vscode-test.mjs` passes `--user-data-dir` at a hashed directory under the system temp
dir. That line is load-bearing: without it `npm test` cannot run from any git worktree.

VS Code opens its IPC socket inside the user-data dir, and macOS caps Unix domain socket
paths at 103 characters. Left alone, `@vscode/test-electron` puts that dir at
`<project>/.vscode-test/user-data`, so the socket path grows with the project path — 86
characters from the main checkout, 129 from a worktree under `.claude/worktrees/`. Past
the cap it fails with `listen EINVAL: invalid argument` before a single test runs,
preceded by `WARNING: IPC handle ... is longer than 103 chars`.

Passing `--user-data-dir` on the `npx vscode-test` command line does not work; the CLI
does not forward it to Electron. It has to be in `launchArgs`.

The hash keys the directory to the checkout, so two worktrees running tests at the same
time do not fight over one socket.

The downloaded VS Code build is a separate cache and still lives in each checkout's
`.vscode-test/`, so a fresh worktree pays a ~300 MB download on its first `npm test`.

### The bd fixture

`src/test/suite/daemonAdapter.test.ts` exercises `DaemonBeadsAdapter` against a real
`bd` CLI, so it needs a real database. The suite builds a throwaway one in
`.test-workspace/` (gitignored):

- `bd init --non-interactive --prefix bktest` creates an embedded Dolt database.
  No external dolt server is required.
- A handful of issues are seeded through the adapter itself, spread across
  `open` / `in_progress` / `blocked` / `closed`, so the board assertions have data
  to check rather than short-circuiting on an empty board.
- The fixture is removed in `suiteTeardown`.

If `bd` is not on `PATH` this extension-host suite skips rather than failing.
The extension matrix does not install bd. The independent shared integration job
does install bd and fails on missing prerequisites; it never uses `skipIfNoBd`.

### A note on performance testing

This document previously described a SQLite-based performance harness
(`scripts/generate-test-db.js`, `scripts/benchmark-loading.js`). Both were removed:
bd 1.x dropped the SQLite backend entirely in favour of Dolt, so neither script
could produce a database the extension can read. Any future performance work needs
to build its fixtures through the `bd` CLI, as the test suite above now does.

## Writing a Test

**The suite uses Mocha's `tdd` interface: `suite()` and `test()`, with node's built-in
`assert`.** This is set by `ui: 'tdd'` in `.vscode-test.mjs` and `src/test/suite/index.ts`.

Do not use `describe()` / `it()`, and use Node's `assert` rather than `chai`.
`sinon` is used for subprocess stubs, fake timers and circuit-breaker tests; these
tests still register with `suite()` / `test()`.

Taken from `src/test/suite/messages.test.ts`:

```typescript
import * as assert from 'assert';
import { migrateUIState } from '../../types';

suite('migrateUIState', () => {
    test('Returns null/undefined/primitive inputs unchanged', () => {
        assert.strictEqual(migrateUIState(null), null);
        assert.strictEqual(migrateUIState(undefined), undefined);
        assert.strictEqual(migrateUIState(42), 42);
    });
});
```

Two rules that have earned their place (see also the Security Rules in `CLAUDE.md`):

- **Assert the specific constraint named in the test title.** `assert.ok(x || !x)`
  always passes and has shipped here before.
- **When testing "rejects X", confirm the rejection is for the right reason.** A Zod
  schema rejecting your input because you misspelled a required field name is not
  evidence that it rejects X.

## Integration Tests

Standalone scripts that validate adapter behaviour and data consistency against a
real `bd`, outside the VS Code host:

| Script | Purpose | Command |
| -------- | --------- | --------- |
| `test-adapter-integration.js` | Test DaemonBeadsAdapter field mapping | `npm run test:adapter` |
| `test-bd-cli.js` | Test bd CLI integration | `npm run test:bd-cli` |
| `test-message-validation.js` | Test Zod validation schemas | `npm run test:validation` |
| `test-field-mapping.js` | Test field mapping between adapters | `npm run test:field-mapping` |
| `test-round-trip.js` | Test data round-trip consistency | `npm run test:round-trip` |
| `test-all.js` | Run all integration tests | `npm run test:all` |

`test-bd-cli.js`, `test-adapter-integration.js` and `test-round-trip.js` each create a
throwaway bd workspace under the OS temp directory (`scripts/lib/bd-scratch-workspace.js`)
and run every command against it with `bd -C`. They never touch this repo's backlog, and
there is nothing to clean up afterwards. The helper refuses to run at all if `bd context`
does not resolve inside that temp directory.

The workspace is removed on exit, including on Ctrl-C. A `kill -9` does leave one behind:
these scripts are a straight line of synchronous `spawnSync` calls, so Node never reaches
the event loop to run a handler. The next run sweeps any `bbk-test-*` directory whose
owning process is gone, so a leak costs one stale directory rather than accumulating, and
running two of these scripts at once is safe.

`npm run test:all` reports 148/148.

`npm run test:all` writes a `test-summary.md` at the repo root. That file is a local
artifact and is gitignored — do not commit it.

### Running Tests

```bash
# Full gate: typecheck, lint, extension suite
npm run verify

# Extension suite only
npm test

# A specific integration script
npm run test:adapter

# All integration scripts
npm run test:all

# With coverage
npm run test:coverage
```

## Visual Testing

Nothing in `npm test` renders the webview. Two interactive harnesses do:

| Harness | What it runs | Command |
| -------- | --------- | --------- |
| `scripts/visual-test-server.js` | Board and mock data in stock Chrome | `npm run test:visual-server` |
| `scripts/visual-test-harness.js` | The real extension inside VS Code | `node scripts/visual-test-harness.js [workspace] [--port=NNNN]` |

Reach for the standalone server first: it starts in seconds, serves on `localhost:3333`
with CDP on 9222, and Chrome DevTools MCP can drive it. Reach for the VS Code harness
when the host itself is the variable — theme variables, Electron rendering, the real
`bd` data path. Pass it a workspace that already has `.beads` (the repo root works) so
it does not seed a throwaway database. `--dataset=showcase` swaps the two adversarial
title fixtures for ordinary ones when capturing screenshots.

### The standalone server duplicates the dialog markup

`generateHtml()` in `scripts/visual-test-server.js` carries its own copy of the edit
dialog rather than importing it from `src/webview.ts`. **Any markup change to that
dialog has to be made in both places**, or the harness keeps validating a DOM that no
longer ships. They have drifted before, silently: the server's copy had lost the
`maxlength` on `#editTitle`, `#editAssignee` and `#editExtRef`, and the `min` / `step`
on `#editEst`, so no input-constraint behaviour could be tested there.

Every control in the dialog carries an `id`, which makes the two copies cheap to
compare — extract the `<dialog id="detailDialog">…</dialog>` block from each and diff
the per-`id` attribute sets. Worth doing after any change to that markup.

### Driving a harness over CDP directly

Chrome DevTools MCP does not work against VS Code's Electron webviews at all —
Puppeteer's `Target.getDevToolsTarget` is unsupported there. It can also wedge against
the standalone server: once the Chrome it attached to exits, every call returns "The
selected page has been closed", `list_pages` included, and only restarting the MCP
server clears that.

Both cases have the same fallback. Node 22 exposes a global `WebSocket` and
`.node-version` pins 22, so raw CDP needs no dependency — though `engines.node` still
allows 20, where that global does not exist:

```js
const targets = await (await fetch('http://localhost:9222/json/list')).json();
const page = targets.find(t => t.type === 'page' && t.url.includes('localhost:3333'));
const ws = new WebSocket(page.webSocketDebuggerUrl);
// then Runtime.enable, and Runtime.evaluate with returnByValue: true
```

Four things that are easy to lose an hour to:

- **A VS Code webview's content sits in a nested iframe.** The target advertised as the
  webview is only the shell. Walk `Page.getFrameTree`, call `Page.createIsolatedWorld`
  on the child frame, and pass the returned `executionContextId` to `Runtime.evaluate`.
  Without it you get the shell's DOM and conclude the board is empty.
- **`Page.captureScreenshot` refuses on anything but a top-level target.** Screenshot
  the workbench page, not the webview frame.
- **Only one VS Code instance may run at a time.** `npm test` aborts with "currently
  only supported if no other instance of Code is running" while the harness is up. Stop
  the harness before running the suite, and give it `--port` so it does not collide with
  the standalone server on 9222.
- **Use `Input.dispatch*`, not `element.click()`.** Anything that depends on input
  modality — `:focus-visible` above all — answers differently for a scripted click than
  for a dispatched one. A synthetic click will tell you a focus ring does not exist when
  a real user sees it on every keyboard-driven open.

## The Extension Development Host

Workspace resolution, the file watchers and the webview are only reachable by
pressing F5 and driving the development host by hand — no automated suite
activates the extension. Three traps, each of which has already cost a debugging
session.

**You cannot open the F5 host's own workspace folder in the development host.**
Testing this repo against this repo does not work, so reach for another folder:
`dotfiles` when you need a real Beads database, a scratch directory when you need
one *without* a database.

**`Add Folder to Workspace` keeps the extension host; `File > Open Folder`
restarts it.** The output channel is the tell — a restart prints a second
`[BeadsAdapter] Environment Versions` banner. This matters when testing how the
extension reacts to the workspace changing: if the host restarted, you tested
activation instead, and activation resolves correctly on its own.

**A board tab outlives a host restart, and the survivor is inert.** The tab stays
and keeps rendering its last cards, but nothing re-adopts it — there is no
`registerWebviewPanelSerializer`. Clicking Refresh logs nothing whatsoever,
because the message handler belonged to the host that went away. So before
concluding a change did nothing, check the log for a second banner and for a
matching `=== Opening Beads Kanban Board ===`; if that second line is missing you
are looking at a dead panel, not a bug. Tracked in the backlog.

## Manual QA Before a Release

The automated suites do not touch the webview. Walk this before cutting a release
(see [RELEASING.md](RELEASING.md)); `scripts/seed-test-data.sh` gives you a
representative database to walk it against.

1. **Board load and filtering**
   - Board loads with the seeded dataset; column distribution looks right
     (Ready / In Progress / Blocked / Closed).
   - Search, Priority, Type and Status filters each narrow the board.
   - Status defaults to "Active" on a first load, so closed issues are hidden.
   - "Clear Filters" returns to that first-load default, not to all-checked.

2. **CRUD and status changes**
   - Create an issue through the dialog; edit an existing one through the same dialog.
   - In create mode, the relationship and comment sections stay disabled until the
     issue exists.
   - Update title, description, priority, type, assignee, estimate and dates.
   - Drag a card between columns and confirm the status actually changed in `bd show`.

3. **Table view**
   - Toggle between views; the same issues appear in each.
   - Sorting: single column by click, multi-column with Shift+click, default Updated desc.
   - Filtering by search, priority, type, status, assignee, labels.
   - Row click opens the detail dialog; clicking an ID copies it.
   - "Load More" pages in correctly.

4. **Tree view**
   - Hierarchy matches `bd list`'s tree output.
   - Filtering keeps matching issues visible with their ancestor chain dimmed as context.
   - Expansion state survives closing and reopening the panel.
   - Sibling sort (Updated / Priority / Title / Created) applies at every level.

5. **Graph view**
   - Renders dependency edges; nodes open the detail dialog.

6. **Relationships and labels**
   - Add and remove labels.
   - Add and remove parent-child and blocks dependencies.
   - `blocked_by` / `blocks` / `children` render correctly afterwards.

7. **Comments and markdown**
   - Add a comment containing markdown and a link; confirm it renders and is sanitized.
   - Oversized markdown is rejected with feedback rather than hanging the webview.

8. **Context actions**
   - "Add to Chat" and "Copy Context" both work end to end.
   - Large payloads are rejected with a clear message.

9. **Read-only mode**
   - Set `beadsKanban.readOnly` and confirm every mutation is blocked with feedback.

10. **Daemon actions**
    - Show status, list daemons, health check, restart, stop, logs.
    - The status bar reflects the actual daemon state.

11. **Error handling**
    - Open a folder with no `.beads` directory and confirm the error is actionable.
    - Point `beadsKanban.bdPath` at a nonexistent binary and confirm the failure is
      readable and does not leak internal paths.

## Continuous Improvement

### Future Optimizations

Virtual scrolling for very large columns is tracked as `bbk-jsi`: reduce DOM nodes so a
column can hold 1,000+ items without degrading. Incremental loading caps how many cards
are *loaded*, not how many end up in the DOM once they are.

### Testing Best Practices

1. **Test with realistic data**
   - Seed fixtures through the `bd` CLI so they match what the extension actually reads
   - Include dependencies, labels, and comments, not just bare issues

2. **Watch the pending count, not just the failure count**
   - A suite that skips is not a suite that passes
   - `daemonAdapter.test.ts` skips wholesale when `bd` is missing, which is easy to
     mistake for green

3. **Exercise both the schema and the CLI paths**
   - `messages.test.ts` / `security.test.ts` cover Zod validation in isolation
   - `daemonAdapter.test.ts` covers the round trip through the real `bd` binary
