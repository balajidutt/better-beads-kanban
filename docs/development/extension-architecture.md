# Extension architecture

This is the technical reference for the TypeScript extension host and the vanilla-JavaScript webview. Shared engineering mandates live in [AGENTS.md](../../AGENTS.md#security-and-correctness); testing procedures live in [TESTING.md](../../TESTING.md). Source and schema definitions are authoritative when a version-specific detail differs from this guide.

## Build, test, and debugging entrypoints

| Command | Scope |
| --- | --- |
| `npm run compile` | Production extension-host bundle, webview bundles, dependency assets |
| `npm run build-extension` | Extension-host bundle only |
| `npm run build-webview` | Browser bundles only |
| `npm run copy-deps` | Copy DOMPurify into `media/` |
| `npm run watch` | Watch the extension-host bundle only; rebuild webview code separately |
| `npm run lint` | ESLint on TypeScript under `src/` |
| `npm test` | Mocha TDD suites through the VS Code test CLI; `pretest` emits TypeScript, copies dependencies, and builds the webview |
| `npm run verify` | Typecheck without emit, lint, and `npm test`; not the production extension-host bundle |
| `npm run test:watch` / `npm run test:coverage` | Configured test watch / c8 coverage entrypoints |
| `npm run test:visual-server` | Standalone Chrome harness with mock data |
| `npm run build-icon` | Render `images/icon.svg` to `images/icon.png` |

Press F5 for the Extension Development Host, then run **Beads: Open Kanban Board**. The Extension Tests launch configuration supports debugging the suite. Use `suite()` / `test()`, not BDD globals. Before selecting individual tests, inspect the installed runner's supported options; do not temporarily change the committed runner as a routine filtering mechanism.

Production code uses `unknown` rather than `any`. Narrow runtime values before access; type assertions alone do not validate untrusted JSON. Test files have intentionally relaxed ESLint rules. Match `.eslintrc.json`: braces on control flow and switch-case lexical declarations, semicolons, no unused bindings. A narrow lint suppression for an intentional control-character regex must retain a useful invariant rather than narrate a change.

## Components and boundaries

| Path | Responsibility |
| --- | --- |
| `src/extension.ts` | Activation, commands, panel lifecycle, messages, read-only enforcement, workspace/repository choice and refresh watchers |
| `src/daemonBeadsAdapter.ts` | `DaemonBeadsAdapter` is the class name; its transport is CLI subprocesses, not a daemon connection. Owns caching, circuit-breaker behavior, mapping and mutations |
| `src/beadsWorkspace.ts` | Pure workspace/repository resolution; no `vscode` import |
| `src/beadsWatch.ts` | Pure watch patterns and refresh-noise exclusions; no `vscode` import |
| `src/types.ts` | Card/message-adjacent types, Zod schemas, persisted-state migration and graph types |
| `src/sanitizeError.ts`, `src/markdownValidator.ts` | Error scrubbing and bounded Markdown validation |
| `src/webview.ts` | Production HTML, CSP, nonce and webview resource URIs |
| `src/filterUniverse.ts`, `src/filterMarkup.ts` | Shared filter universes and generated filter markup |
| `src/webview/board.js` | DOM rendering, filters, dialogs, state, interaction and message handling |
| `src/webview/treeBuilder.ts` | Pure hierarchy, filtering, sibling sorting and connector structure |
| `src/webview/filterStateMachine.ts` | Inclusive-selection transitions and derived presets |
| `src/webview/cardRelationships.ts` | Pure relationship projection shared with UI behavior |
| `src/webview/graph-view.js`, `src/webview/graph-layout.js` | Graph rendering and layout |
| `media/styles.css`, `media/marked.min.js`, `media/purify.min.js` | Theme-aware styling, Markdown rendering and sanitization |

The UI is not all TypeScript. `board.js` and graph JavaScript are outside the current TS-only lint/typecheck coverage. `getWebviewHtml` tests and source-text assertions are not rendered DOM coverage. The browser harness has its own page/dialog markup; production changes must keep the relevant harness markup aligned.

### Workspace selection and watching

Resolution in `beadsWorkspace.ts` prefers a saved picker selection, then a workspace root containing a repository `.beads`, then a bounded upward walk, then the first root fallback. Repository markers are `metadata.json`, `config.yaml`, `embeddeddolt`, or `dolt`; a bare `.beads` directory is insufficient. The upward walk refuses `$HOME`, while explicitly opening or selecting that folder remains distinct. `DEFAULT_MAX_ASCEND` is 6. The persisted repository-selection key is `beadsKanban.repoPath`.

Watchers observe `.beads/*` and Dolt storage-change signals, including `.beads/{dolt,embeddeddolt}/*/.dolt/noms/*`. They never parse storage as issue data. The deny predicate filters transient/noisy paths. Repository switches rebind watchers; panel disposal clears watchers, handlers and timers. An external worktree may need the main checkout added as another workspace root or selected in the folder picker; it does not contain its own backlog database.

`retainContextWhenHidden: true` retains a hidden webview within one host process. It is not reattachment after an Extension Host restart. Distinguish activation, live folder changes, panel recreation, and restart recovery in evidence; [TESTING.md](../../TESTING.md#the-extension-development-host) describes the existing restart limitation.

## Host/webview protocol

Inspect the `WebMsg` / `ExtMsg` unions and switch in `src/extension.ts`, the schemas in `src/types.ts`, and actual sends in `board.js` together. A declared handler is not proof that the current UI exercises it.

| Webview → host | Purpose |
| --- | --- |
| `board.load`, `board.refresh`, `board.loadMinimal` | Board/minimal data and refresh |
| `board.loadColumn`, `board.loadMore` | Column slices and further pages |
| `table.loadPage` | Host-side table-page API |
| `repo.select` | Choose the Beads repository |
| `issue.create`, `issue.move`, `issue.update`, `issue.getFull` | CRUD/status and on-demand detail |
| `issue.addComment`, `issue.addLabel`, `issue.removeLabel` | Comments and labels |
| `issue.addDependency`, `issue.removeDependency` | Relationships |
| `issue.addToChat`, `issue.copyToClipboard` | Bounded context export |
| `state.uiState` | Validated persistence |
| `ui.confirmDiscard` | Host confirmation for unsaved edits |

Host replies include `board.data`, `board.minimal`, `board.columnData`, `table.pageData`, `issue.full`, `mutation.ok`, `mutation.error`, and `ui.confirm.result`. `webview.cleanup` is also sent during disposal, outside the current response union. Preserve request/response identity and validation when changing a path.

### Persisted UI state

`saveState()` writes both `vscode.setState` and a fire-and-forget `state.uiState` message. The host validates through `UIStateSchema` and stores `beadsKanban.uiState` in `context.workspaceState`. Before returning saved state, it runs `migrateUIState` then `safeParse` again. Invalid state is discarded rather than trusted. Board/minimal/repository responses can carry `payload.uiState`; those persisted values override the webview's initial `vscode.getState()` values before rendering. The webview does not register a mutation callback for the persistence message.

The current toolbar stamp is **`topBarFiltersVersion: 3`**. Inclusive multi-select arrays are the actual selected values; `[]` means none, not all. Migration is pure:

- Version 1/no stamp: expand old empty-array “All” values to the current universes.
- Versions 1 and 2: a priority selection equal to the frozen v2 universe `['0', '1', '2', '3']` expands to include P4. Deliberate proper subsets remain subsets; v2 empty selections remain empty.
- Stamp version 3 before validation. Already-current state passes through unchanged.

`treeSort` stores `{ id, dir }` for `updated_at`, `priority`, `title`, or `created_at`. `treeExpanded` stores only deviations from the depth default, not every row. `trimTreeExpanded()` removes stale/default entries and keeps at most 500 entries with keys at most 50 characters. An invalid field can reject the entire UI-state payload, so these bounds protect unrelated persisted settings too.

## Data adapter and load paths

The extension never opens Dolt, SQLite, or JSONL files as data. `execBd` runs the configured `bd` executable with argument arrays and `shell: false`; `ensureConnected()` probes `bd stats --json`. The name `DaemonBeadsAdapter` and some diagnostic strings are historical names, not a daemon-start protocol. The executable comes from `beadsKanban.bdPath` or PATH; the extension does not manage a separate Dolt executable.

The card types express different data/evidence levels:

- **MinimalCard:** identity, title, status, priority and basic placement/relationship information needed for initial rendering.
- **EnrichedCard:** additional badges/relationships/labels available from mappings or enrichment.
- **FullCard:** the on-demand detail/edit fields, comments and complete issue context.

`getBoardMinimal` uses one `bd list --json --all` query and maps relationships with a reverse index rather than fetching each card separately. `getIssueFull` uses `bd show --json` on demand. Column enrichment has bounded batches of 50 and parallel per-issue fallback; the webview's `cardStateLevel` avoids unnecessary detail reloads. Preserve these distinctions when adding badges or fields: a new per-card `show` on initial load is an N+1 regression.

### JSON shapes are version-dependent

Do not use a universal “list has field X; show never has X” table. The adapter accepts multiple shapes, including metadata/top-level flags, string/object labels, and dependency arrays. It derives `parent`, `children`, `blocks`, and `blocked_by` projections from CLI edges where available. `bd show` may report relationship counts without returning every corresponding relationship array. Verify a required shape with supported CLI output and fixtures rather than assuming absence means zero.

Important fields include opaque `id`, `title`, `description`, `status`, numeric `priority`, `issue_type`, assignee/estimate/labels, created/updated/closed times, `external_ref`, `acceptance_criteria`, `design`, `notes`, due/deferred times, flags and event/agent metadata. Comments and relationships have their own shapes; schema and mapper validation belong at the boundary.

`bd ready` is the readiness authority. Existing minimal/enriched mappings also derive convenience `is_ready` values from blocking counts; that local projection is not a complete specification of CLI readiness. Do not extend it into a competing readiness algorithm.

### Columns, pagination and settings

The four logical columns are Ready (open and ready), In Progress (`in_progress`), Blocked (explicit blocked status or blocking/not-ready open work), and Closed. A move to Ready maps status back to `open`; readiness still depends on Beads semantics.

| Setting/API | Declared default or bound | Current use/limit |
| --- | --- | --- |
| `beadsKanban.initialLoadLimit` | 100; range 10–1000 | Passed to minimal/initial loads |
| `beadsKanban.pageSize` | 50; range 10–500 | Further column loads |
| `beadsKanban.preloadClosedColumn` | false | Incremental fallback path; not a guarantee about the preferred minimal-load path |
| `beadsKanban.maxIssues` | 1000; range 100–50000; deprecated | Still used by `getBoard`, including legacy/table/repository-selection paths |
| `beadsKanban.autoLoadOnScroll` | false | Contributed setting without a current source reader; do not advertise active auto-loading |
| `beadsKanban.lazyLoadDependencies` / `issuePrefix` | true / empty string | Contributed settings without current source readers |
| `BoardLoadColumnSchema` | offset ≤5000; limit ≤500 | Validate requested column slices |
| `TableLoadPageSchema` | offset ≤100000; limit ≤500 | Validate the host table-page API |

`getBoardMinimal`'s own default is 5000, but host callers supply `initialLoadLimit`. `getBoard` requests `maxIssues + 1`, trims to the cap and can report truncation. The preferred initial path is minimal loading; do not describe every initial board load as independent per-column lazy queries. The current Table view pages in the browser, despite the available host table-page API.

Column state tracks loaded ranges, total counts and `hasMore`, with loaded/total headings and Load More controls. The UI sends `board.loadMore`; `board.loadColumn` and `table.loadPage` are not current board.js send paths. Response compatibility includes flat cards and, on incremental paths, per-column metadata.

When replacing a legacy `maxIssues` preference, choose explicit initial/page limits and verify all affected paths; changing one setting does not remove the remaining legacy cap:

```json
{
  "beadsKanban.initialLoadLimit": 200,
  "beadsKanban.pageSize": 100,
  "beadsKanban.preloadClosedColumn": false
}
```

## Views and interaction

### Filter transitions

Status defaults to Active (`open`, `in_progress`, `blocked`, `deferred`); Priority and Type default to All. `tombstone` and `pinned` belong to the full Status universe, not Active. All/Active preset rows are derived by set equality, never independent stored state.

| Action | Result |
| --- | --- |
| Select unchecked Active | Active subset |
| Select checked Active | Full universe |
| Select unchecked All | Full universe |
| Select checked All | Empty selection |
| Toggle individual value | Add/remove from selected set |

Priority and Type use the same machine without Active. Clear Filters restores the first-load defaults, not all checked statuses. No selected statuses produces “No statuses selected”; otherwise an empty filtered result produces “No issues match the current filters.”

### Tree view

`viewMode === 'tree'` renders in `#board`, with its toolbar button between Table and Graph. Each row has connector guides, caret, status glyph, copyable monospace ID, priority/type pills and a single-line title; assignee is right-aligned. Status glyphs are ○ Open, ◐ In Progress, ⊘ Blocked, ◌ Deferred, ● Closed, ✕ Tombstone and ◉ Pinned, with a formatted-name tooltip.

- Structure uses each card's `parent` pointer, not `children[]` arrays. Missing parents become roots. Deterministic cycle/self-parent handling renders every card once.
- Filtering retains matches plus their complete ancestor chains. Nonmatching ancestors are dimmed; connectors use the displayed tree so pruned branches leave no dangling guides.
- Top-level nodes default expanded one level; deeper nodes default collapsed. Persist only expansion overrides. Filters/search narrower than first-load defaults auto-expand matching paths without changing stored overrides; the default Active filter alone does not trigger this.
- `flattenVisibleRows()` emits ancestor `guides` and `isLast`. CSS draws vertical/elbow/tee connectors using tree/widget border variables. Stretch alignment and uniform single-line row height keep lines continuous; title ellipsis is structural, not cosmetic.
- Sibling sorting is independent of Table sorting, applied at every depth: Updated descending by default, Priority, Title or Created; ties use ID ascending and missing priority is 2.
- Clicking opens details. Enter and directional keys provide tree navigation; validate keyboard focus as well as appearance.

### Shared create/edit dialog

Create and edit already use the same static `#detailDialog` generated by `src/webview.ts` and controlled by `openDetail` in `board.js`. Create mode has `card.id === null`; relationship/comment editing waits until the issue exists. `detailDirty` and `editBaselineValues` govern the shared unsaved-change state and host discard confirmation.

Static form fields are reused across opens, so handler cleanup matters. The standalone visual server duplicates page/dialog HTML while sharing some generated filter markup; keep its controls and attributes aligned with production. There is no separate production `editForm.js` module to restore.

For a native `<dialog>`, apply display layout only to its `[open]` state. Unconditional `display: flex` can make a closed dialog visible:

```css
#detailDialog[open] {
  display: flex;
}
```

Markdown preview uses marked with GFM and DOMPurify. Validate large payloads before expensive processing. `LONG_TEXT_MAX` is 65536 to bound CLI argument-sized text; chat/clipboard have separate caps. Read the actual schemas when adding a field or UI option rather than inferring accepted values from another dropdown.

## Bundling and package contents

`scripts/build-extension.js` takes `src/extension.ts` to Node `out/extension.js` with `vscode` external. `scripts/build-webview.js` builds browser bundles, including IIFE `out/webview/board.js`. Runtime Zod and Pragmatic Drag and Drop are bundled; test frameworks are development-only. Source maps are useful for local debugging but excluded from the normal VSIX.

Keep the production extension bundle, browser bundles, required media, rendered icon/screenshots, `package.json`, `README.md`, `CHANGELOG.md`, and required licenses. The small retained GitHub templates are governed by `.vscodeignore`, not an assumption that every `.github` file ships. Source, tests, worktrees, agent configuration, internal development docs and tooling stay out. Gitignore does not control VSIX contents; verify the package listing and retained assets, not just a file-count ceiling. Debug-only source-map inclusion is an explicit packaging choice, not a default release change.

`npm run compile` copies DOMPurify through `copy-deps`. The HTML uses nonce-based scripts and existing inline styles under its CSP; changes must preserve validation/sanitization and least-privilege resources. `package.json` and the cache-busting version in `src/webview.ts` must match; use `npm run release:bump -- X.Y.Z` under the [release procedure](../../RELEASING.md), not independent manual edits.

For Windows local packaging, use PowerShell rather than Git Bash where `vsce package` can fail silently. Packaging runs `vscode:prepublish`; that invokes the production compile. Fork publication remains the guarded GitHub release path, not Marketplace packaging/publishing. The agent workflow's host-support claims are separately documented; an application Windows CI job is not proof of native Windows orchestration support.

## Migration audit

Source baseline: `CLAUDE.md` at repository commit `97d7fc926042d155703dd9288d91ba9b07bf6bbc`. This audit records destinations and corrections, not a fresh test run or a product-behavior change. Original content remains available in Git history.

| Original section/lines | Maintained destination and disposition |
| --- | --- |
| Branding 1–3 | Root Claude adapter only; neutral policy belongs to AGENTS |
| Overview 5–7 | Components/data adapter here; daemon wording removed |
| Build/watch, packaging, lint/type patterns 9–105 | Build and bundling here; retain Windows packaging caveat, unknown-before-access discipline and lint conventions; replace outdated daemon-info/type-assertion examples with source/schema references |
| Tests/run 107–125 | Build entrypoints here and TESTING; retain TDD/negative-test guards, remove routine runner-edit advice |
| Core components 127–148 | Components/workspace sections; add graph, filter and relationship helpers; preserve vscode-free boundaries |
| Protocol/state 150–188 | Complete protocol and persisted state here; correct repo key and current filter version 3, preserve v1/v2 migration, tree limits and precedence |
| Issue shape 190–203 | Version-dependent JSON and CLI/readiness authority here; no universal field-absence claim |
| Columns/filter semantics 205–245 | Columns and filter transitions here; preserve None/All/Active/default/reset behavior |
| Tree 247–256 | Tree section including orphans/cycles, ancestor context, overrides, guides, sort and keyboard behavior |
| Adapter/field table 258–283 | CLI probe, three-tier/N+1 and defensive shapes here; replace contradicted fixed command-field table |
| Validation 285–295 | Canonical AGENTS security rule plus source schemas; opaque custom/hierarchical IDs retained |
| Incremental loading 297–367 | Current load paths/settings here; distinguish preferred minimal path, fallback APIs, inactive settings and still-used maxIssues |
| Planned consolidation 369–371 | Shared create/edit dialog here; document implemented sharing, not a future duplicate-form project |
| HTML safety 377–383 | AGENTS security rule 1; defense-in-depth and no exception retained |
| CLI ordering 385–397 | AGENTS security rule 2; flags before separator retained without change-narrating code comments |
| Handler/ID validation 399–407 | AGENTS security rule 3; both Zod-before-use and IssueIdSchema retained |
| Subprocess/error safety 409–419 | AGENTS rules 4–5; explicit bounds and no raw stderr retained |
| Test correctness 421–427 | AGENTS rule 6 and TESTING; correct rejection reason and regression sensitivity retained |
| Listeners/shared state 429–441 | AGENTS rules 7–8 and dialog mechanics here; duplicate-form historical narrative reduced to current ownership |
| GitHub identity 443–452 | AGENTS public-identity policy; scoped API identity/restoration remains distinct from SSH and commits |
| Dialog/type pitfalls 454–495 | Dialog and unknown-value guidance here; omit before/after comments and unsafe assertion-as-validation implication |
| Releases 497–508 | AGENTS fork guardrails and RELEASING; preserve sole runbook, paired versions and Marketplace prohibition |
| Bundling 510–599 | Build/bundling here; remove stale zod external exception, universal counts/sizes and webview-watch implication |
| Notes 601–614 | Components/bundling here, TESTING, AGENTS fork policy; fixture seeding requires isolated approved scope, not real-backlog initialization |
| Beads/sync/routing 615–691 | AGENTS high-level policy and workflow backlog-operations reference; retain transfer/working-set detection, routing and explicit bootstrap/repair boundaries |
| Worktrees 693–721 | AGENTS and workspace/backlog references; retain nested/external distinction and shared data, replace branch-only closure with approved main-landing policy |
| Previous AGENTS attribution/closure | Shared identity/approval policy in AGENTS; Claude-only wrapper fallback in adapter; manager-owned OpenCode writes and reviewed main landing before closure |
| Inbound README, PR template and adapter comment | README/PR checklist link the source-hosted architecture and security destinations, so excluded internal docs need not ship in the VSIX; the adapter comment retains only the enduring CLI separator constraint, without a removed-section pointer |

Static inspection also identified existing implementation caveats, not fixes in this migration: local readiness projections are narrower than CLI authority; some contributed settings are inert; a displayed Deferred edit option and mutation schemas need separate reconciliation; the invalid table-page response path needs separate review; and HTML-sink compliance needs a dedicated audit rather than an assumption that every current assignment meets the mandate. These observations are not verification of a product fix or authorization to create/close follow-up issues.
