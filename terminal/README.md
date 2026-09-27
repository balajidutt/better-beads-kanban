# Beads terminal proof of concept

Private, read-only browser for one Beads repository, using Ink 7.1.1 and React
19.2.4. Requires Node 22+, an interactive TTY on stdin/stdout, and an existing
Beads repository with `bd` available. Minimum terminal size: **100×24**.

## Launch

From the repository root:

```sh
npm --prefix terminal ci --ignore-scripts
npm --prefix terminal run build
node terminal/dist/cli.mjs --repo /absolute/maincheckout
```

For an external Git worktree, point `--repo` at the main checkout containing
`.beads`; do not initialize a database in the worktree. The terminal has its own
manifest and lockfile. Its ESM build leaves dependencies external: keep
`terminal/node_modules`, including Ink and its Yoga runtime, available. This is
not a single-binary distribution.

| Option | Default / meaning |
| --- | --- |
| `--repo PATH` | Current directory; resolves one Beads root and checks `bd context` against it |
| `--bd-path EXECUTABLE` | `bd` on PATH; accepts an executable path |
| `--limit N` | `1000`; integer from `1` through `5000` |
| `--clipboard auto\|osc52\|manual` | `auto`; see clipboard behavior below |
| `--help` | Print launch help; no TTY required |

Unknown, duplicate and missing options are rejected. There is no in-app
repository switching.

## Views and controls

**Tree** is the default; `v` cycles Tree → Table → Kanban. Tree retains loaded
ancestors as dimmed context for matching descendants. Table is a flat list.
Kanban groups by **stored status**, not inferred readiness: an open issue with a
blocker remains in Open. Empty columns remain navigable and have no selection.
Filters and an eligible selected ID carry across views; otherwise selection is
reconciled to an available row. Details are fetched on demand and cached until
refresh.

The selected issue has a **●** marker and inverse highlighting in every view.
Only expandable Tree rows have **▸/▾** indicators. Tree priority and type use
separate colored, bold badges, such as `[P2] [task]`. The active view is an
inverse-highlighted tab; the focus label and pane border identify keyboard focus.
Visible Kanban columns share the full main-pane width with one-cell gaps, while
additional columns remain horizontally scrollable.

| Context | Keys |
| --- | --- |
| Navigation | `↑`/`↓` or `k`/`j`: select; `PageUp`/`PageDown`: move a page in the focused pane |
| Tree, main pane | `←`: collapse or select parent; `→`: expand or select first child; `Space`: toggle expansion |
| Kanban, main pane | `←`/`→`: change column; vertical movement stays within that column |
| Panes | `Tab`: switch main/details focus; vertical/page keys scroll focused details |
| Search | `/`: edit live search; `Backspace`/`Delete`: remove last grapheme; `Esc`/`Enter`: finish, retaining query |
| Filters | `f`: open; `Tab`/`Shift-Tab` or `←`/`→`: change Status/Priority/Type group; `↑`/`↓` or `k`/`j`: choose; `Space`: toggle |
| Filter presets | `s`: Active for Status, All for Priority/Type; `a`: All in current group; `n`: None in current group; `r`: reset all filters and search |
| Close filters | `Esc`/`Enter` |
| Other navigation keys | `r`: refresh snapshot/details; `y`: copy selected ID; `?`: help; `q`: exit |
| Help | `Esc`, `Enter` or `?`: close |
| Any mode | `Ctrl-C`: exit |

Default filters are Active statuses (`open`, `in_progress`, `blocked`,
`deferred`), all priorities P0–P4 and all known/loaded types. None means no
matches. Search is case-insensitive over loaded ID, title, description and labels.
Below 100×24, the app shows a resize prompt and accepts only `q`/`Ctrl-C`.

### Clipboard

`y` copies only the exact validated issue ID, with no title or added newline.
`auto` invokes `/usr/bin/pbcopy` on macOS; other platforms show the ID for manual
copy. Failure, timeout or cancellation of `pbcopy` also gives a manual fallback.
`manual` always displays the ID. `--clipboard osc52` is explicit opt-in: the
message **“OSC 52 clipboard request sent”** confirms emission only, not that the
terminal accepted it or changed the clipboard. The maintainer confirmed actual
copy/paste in macOS iTerm on 2026-09-23; the mode was not recorded. Linux and
explicit OSC 52 clipboard acceptance remain unverified.
Copy notices, including errors and manual-copy fallback, disappear after four
seconds. Press `y` again to display the result and restart that interval.

## Read boundary and limits

The runtime permits only these `bd` argument shapes, executed in the resolved
repository without a shell:

```text
version --json
context --json --readonly --sandbox --dolt-auto-commit off
list --json --all --limit <cap+1> --readonly --sandbox --dolt-auto-commit off
show --json <validated-id> --readonly --sandbox --dolt-auto-commit off
```

No SQL, JSONL fallback, mutations, sync, database lifecycle or agent-dispatch
commands are exposed. Fixture setup in test scripts is separate from this
allowlist.

- Snapshots are bounded: default 1,000, maximum 5,000 loaded issues. A cap+1 read
  detects truncation; the extra issue is discarded. There is no pagination.
- Filters, counts and hierarchy cover **loaded issues only**. A partial-snapshot
  warning makes this explicit; Tree marks `[parent not loaded]` where applicable.
- Loaded parent chains support at most **512 ancestor links**, counting unique
  links before a cycle repeats. Deeper snapshots are rejected as unsupported;
  the last good snapshot is retained and marked stale.
- Failed refreshes retain the prior snapshot and show a stale/error state.
  Stale asynchronous results cannot replace newer selections or refreshes.
- At most one list and one detail request run independently; they **can overlap**.
  Rapid requests coalesce to the latest pending work. Reads have a 30-second
  deadline and a per-stream bound of 50 × 1024 × 1024 decoded JavaScript string
  units (the extension's existing limit, not an exact byte bound). Disposal
  terminates children, escalating after a 250 ms grace period.

With tested **bd 1.2.2**, `show --json` omits comment bodies and reverse-edge
`dependents`. Consequently details can have empty comments/children/blocks even
when those exist in the database. List snapshots still provide hierarchy and
blocker relationships. The app does not issue extra comment or reverse-edge
queries to fill those gaps.

## Validation record — 2026-09-23

Recorded runs used macOS Node **24.21.0** and disposable Linux Node **22.23.2**,
with **bd 1.2.2**, reporting the same build hash **`6c124203e`**. Linux used the
checksum-verified official archive; macOS used the installed build. Dependency
versions were Ink **7.1.1** and React **19.2.4**.

| Check | Recorded result |
| --- | --- |
| Terminal tests | 52 passing after the UX pass, macOS and disposable Linux |
| Shared tests | 68 passing |
| Extension tests | 493 passing on final rerun, VS Code 1.139.0, exit 0 |
| Root and terminal lint/typecheck/build | Passed |
| Shared/terminal import boundaries | Passed |
| VSIX inspection | 37 files, 953.19 KB; no terminal sources, dependencies, outputs or docs |
| Linux PTY | 11 scenarios passing in 65.8 s after the UX pass, including real-time notice expiry |
| Linux real-bd integration and benchmark | Passed |
| Maintainer PoC acceptance | Accepted; actual copy/paste confirmed in macOS iTerm |

PTY coverage includes views/controls, resize, manual-copy fallback, rapid
navigation, `q`, Ctrl-C and SIGTERM cleanup, missing executable, malformed JSON,
backend failure, real timeout and stdout/stderr overflow. It checks TTY/cursor
restoration and child cleanup. These automated results do not replace manual
macOS/Linux acceptance or actual clipboard verification. No native development
tools were installed on macOS; disposable Linux resources were cleaned up.
The extension tests emitted `DisposableStore` diagnostics despite passing, as in
Phase A; they remain untriaged. Linux evidence comes from local disposable
containers, not a hosted Actions run. The separate terminal CI job is configured.

Reported terminal audit: **one low-severity development finding**, esbuild's
Windows development-server advisory
[GHSA-g7r4-m6w7-qqqr](https://github.com/advisories/GHSA-g7r4-m6w7-qqqr).
No development server is used here. The reported production audit had **zero**
findings; this is a dated audit result.

### Performance scope

These are controller/projection measurements, **not end-to-end screen latency**:

| Measurement | Recorded Linux result |
| --- | --- |
| Real-bd list calls | 772–843 ms |
| Synthetic 5,000-issue projection | 48.9 ms |
| 100 controller navigation operations + projections, Tree | 31.6 ms total |
| Same, Table | 26.4 ms total |
| Same, Kanban | 31.5 ms total |

Synthetic services use mocked 15 ms list and 25 ms detail delays, with no `bd`
processes. Integration observed a maximum of one live `bd` process in that run;
this is not a general single-process guarantee. The independent list/detail
limits above permit overlap.

### Reproduce checks

From the repository root, after installation:

```sh
npm --prefix terminal run typecheck
npm --prefix terminal run lint
npm --prefix terminal test
npm --prefix terminal run build
npm run test:shared
npm run test:shared:boundaries
```

In disposable Linux with Node 22+, Python 3 and real `bd` available:

```sh
npm --prefix terminal run test:pty
npm --prefix terminal run test:integration
npm --prefix terminal run benchmark
```

PTY tests require the built CLI and use temporary fake-bd fixtures. Integration
and benchmark scripts create and destroy isolated real-bd scratch repositories;
set `BD_BIN` to an absolute executable path if needed. The benchmark includes the
real integration run as well as synthetic cases.

## Checkpoint B: accepted as a proof of concept

On 2026-09-23, the maintainer accepted the PoC, reporting that it functionally
does most of what they wanted and confirming actual copy/paste in macOS iTerm.
UX improvements were noted but not yet specified or authorized for implementation.

This is prototype acceptance, not a claim that every manual check below passed.
Manual Linux acceptance, Linux/explicit OSC 52 clipboard verification, and
item-by-item results for the full checklist remain unrecorded. For further
platform validation, use a disposable fixture and record:

- [ ] Launch and visit Tree, Table and Kanban; check stored-status grouping.
- [ ] Search and use Status/Priority/Type filters, including Active, All, None
  and reset; verify filters, eligible selection and details survive view changes.
- [ ] Expand/collapse Tree, scroll lists and details, move between Kanban columns
  including an empty column, and resize below/above 100×24.
- [ ] Change a fixture issue externally, then press `r`; verify refreshed content
  and preservation of an eligible selected ID.
- [ ] Press `y` and paste the ID once into a scratch buffer, checking the exact
  ID. On Linux, opt into OSC 52 for this check if supported; also verify manual
  fallback. A “request sent” message alone is not clipboard acceptance.
- [ ] Exit cleanly and record platform, terminal, versions and any failures.

## Architecture and packaging decision

The terminal consumes the provisional shared public surfaces
`src/shared/model.ts` (UI-independent model/projections) and `src/shared/node.ts`
(Node reader/runner), plus UI-independent repository discovery and filter
constants. It does not import the extension adapter. Its private ESM manifest is
separate from the extension's CommonJS build; terminal dependencies and outputs
must stay out of the VSIX.

Before supporting two maintained applications, the recommendation is a private
`packages/backlog-core` package. Follow-up work must define CJS/ESM exports,
workspace configuration, build order, shared/consumer tests and packaging checks.
The provisional source boundary is not a publication contract. No publication or
commits are authorized by Checkpoint B acceptance.
