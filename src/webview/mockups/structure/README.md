# Structure design snapshots

Open [index.html](index.html) locally; no server or dependencies. Compare
[A: table](table.html), [B: grouped](grouped.html) and
[C: accordions](accordion.html). All IDs, titles, statuses, readiness labels and
counts are **synthetic demo data**, not live backlog facts. The evaluation covered
compact tables, grouped lists and relationship accordions. **Refined Option B
(grouped lists) is the selected design**; A and C remain comparison references.
These mockups do not implement the extension enhancement.

## Trade-offs and boundaries

| Concept | Strength | Cost / default |
| --- | --- | --- |
| A | Aligned status/direct-count columns; full history visible | Dense, considerable wrapping on narrow screens; nothing hidden |
| B | Not closed first, concise counts and keyboard-accessible Unlink previews | Closed context hidden in native disclosures, including closed parents; previews may appear centered |
| C | All four relationship summaries visible at a glance | All disclosures initially collapsed; more navigation; multiple may stay open |

These are static issue-detail contexts, not board redesigns or production dialog
markup. Native theme radios and `details` are functional demonstrations only.
A/C keep disabled action illustrations. B has 59 row-specific native Unlink
buttons: rel33 Parent 1 + Blocked By 33, kids24 Parent 1 + Children 24. None
appears in Blocks. Each opens its own auto-popover identifying the current issue,
related ID and relationship: **Demo only: no relationship is removed**. Neither
issue is deleted. Native Close/hide or Escape dismisses the preview; there is no
remove/confirm action. Production confirmation policy remains undecided. Closed
rows' controls require expansion; 19 Unlink buttons are initially visible.
Search, add and save remain disabled with visible, associated explanations.
Related rows are text, not navigation. Only sibling files and anchors are linked.
No scripts, handlers, network resources, CLI, host messages, listeners, dirty
state or persistence are present. Reload/disclosure behavior is browser-native,
not evidence of extension restoration. Titles/static rows have no added tab stop;
Enter/Space activates the specifically focused native control. Native popovers
are not promised to anchor beside the row or trap focus. Check native popover
support and focus behavior in the target browser; there is no JavaScript fallback.

Themes use CSS sibling selectors and local system fonts; no `:has` support is
required. Light/dark/simulated high contrast approximate VS Code, not real theme
integration. IDs wrap without shortening and titles remain complete in markup.
Status text/glyphs and borders supplement color; keyboard focus has an outline.
B uses Tree hues (Open green, In progress cyan, Blocked red, Deferred/Closed
gray), with theme-specific foregrounds. B-only CSS is inline and opt-in scoped;
the shared stylesheet serves all concepts. Popovers have explicit themed surfaces,
viewport-bounded dimensions, wrapping/scroll and sticky Close. Forced-colors
system-color fallback is provided in source, not claimed rendered evidence.
Tables retain native headers/captions; grouped lists stack below 38rem. Browser
checks of these simulated themes do not establish production theme fidelity.

Static isolation: `.vscodeignore` excludes `src/**`. Bundlers name
`src/extension.ts`, `src/webview/board.js`, `graph-layout.js` and `graph-view.js`
as entrypoints, not these files. These static boundaries are not a substitute
for inspecting the actual VSIX listing when verifying package contents.

## Fixture ledger

Every related row (`tr` in A/C, `li` in B/index) carries `data-scn`, `data-status`
and `data-unresolved-blockers`. Counts are numbers or literal `unknown`; absent
status is literal `unknown`, while an unrecognized supplied value is retained.
IDs are opaque, including the custom/hierarchical child ID. The same IDs, titles,
statuses and direct counts occur once per concept. Empty relationships have no
row, not a fabricated issue. Index edge samples are separate from scenario totals.

**Definitions:** stored Open means only `open`; B's **Not closed** means known
`open`, `in_progress`, `blocked`, `deferred`. A/C and the shared showcase retain
the equivalent “unfinished” wording. Closed and unknown/unrecognized statuses
stay separate; unknown is never assumed not closed. B omits known-zero
status-breakdown/unknown-status entries only: omission means known zero, never
unknown. Link and Not closed/Closed totals retain zeros for empty relationships.
B rows say **Direct blockers: N** or **Direct blockers: Unknown**. Its short
summary counts issues with a positive direct count and issues with unknown
counts, never sums counts across relationships. rel33 Blocked By says “1 issue
has blockers · 1 blocker count unknown”; kids24 Children says “4 issues have
blockers · 3 blocker counts unknown”. Parent and Blocks use their own rows only.
A positive unresolved-direct count denotes fictional dependency blockage,
independent of stored Blocked or Deferred. Zero is not proof of readiness.
`bd ready` is the future readiness authority; not-ready need not have an inferred
dependency cause. Summaries are per relationship, never cross-section unique
issue totals or sums of all related issues' blocker counts.

**Synthetic assumption:** a closed blocker is resolved. Closed demo rows have
direct count 0. Actual CLI status/close/blocking semantics require future real-bd
verification; these artifacts establish none of them.

| Scenario / relationship | Demo IDs | Stored statuses | Direct counts |
| --- | --- | --- | --- |
| rel33 / Parent | `demo-rel33.parent` | closed 1 | 0 |
| rel33 / Blocked By | `demo-rel33.b01`–`b33` | open 3 (01–03), closed 30 (04–33) | 01: 2; 02: 0; 03: unknown; 04–33: 0 |
| rel33 / Blocks | `demo-rel33.downstream.1`, `.2` | open 1, closed 1 | 1, 0 |
| rel33 / Children | none | empty | no rows |
| kids24 / Parent | `demo-kids24.parent` | closed 1 | 0 |
| kids24 / Blocked By | none | empty | no rows |
| kids24 / Blocks | `demo-kids24.downstream.1`, `.2` | open 1, closed 1 | 1, 0 |
| kids24 / Children | child 01: `demo-custom.delivery.2026.phase-a.child.01`; 02–24: `demo-kids24.c02`–`c24` | open 7 (01–07); in_progress 4 (08–11); blocked 3 (12–14); deferred 2 (15–16); closed 8 (17–24) | 01–07: 2/0/unknown/0/1/0/0; 08–11: 1/0/unknown/0; 12–14: 0/2/unknown; 15–24: 0 |

Per concept: **63 related rows**, 36 marked rel33 and 27 kids24. These are marker
audit totals, not displayed cross-relationship summaries. rel33 Blocked By has
3 unfinished: 1 positive, 1 zero, 1 unknown direct count. kids24 Children has 16
unfinished: 4 positive, 9 zero, 3 unknown direct counts. Neither fixture has
unknown statuses. Blocks in each has 1 positive unfinished row and 1 closed row.

Titles: rel33 b01 and kids24 child 01 are long-title cases. b04–b33 are
“Completed prerequisite NN”; c17–c24 are “Completed child NN”. The remaining
titles are fully stored in each HTML page; no tooltip is required to read them.

| Index showcase / `data-scn` | Relationship / rows | `data-status` / direct count | Interpretation |
| --- | --- | --- | --- |
| Empty | Children / 0 | no row | Complete empty snapshot, not failure |
| `edge-status` | Children / 2 | unknown/unknown; reviewing/0 | Missing and unrecognized statuses; 2 unknown statuses, 0 known unfinished |
| `edge-count` | Blocked By / 1 | open/unknown | Unknown count stays separate from 0 |
| `edge-blocked` | Blocks / 1 | blocked/0 | Stored blocked retained without dependency blockage |
| `edge-ready` | Children / 1 | open/0 | Fictional not-ready per bd ready, no cause invented |
| `edge-stale` | Blocked By / 1 loaded | in_progress/unknown | Stale partial row; final totals unknown, not 0 |

Index has 6 marked rows; none belongs to rel33/kids24. In the stale example only
the loaded subset has a status count; unknown final totals cannot be inferred.

## Reproducible browser checklist

Record browser name/version and results from local `file://` index.html:

- Check B at desktop width in light, dark and simulated high contrast; at
  360 CSS px and desktop width with 200% zoom in one theme; expand all groups
  and inspect a preview at narrow width. Full IDs/titles, no horizontal overflow
  or clipping, readable text/glyph status, visible focus and themed previews
  with reachable Close are required.
- Tab/Shift-Tab through radios, disclosures and Unlink; native radio arrows and
  Enter/Space on summaries. Enter on one Unlink and Space on another. Sample
  Parent, open Blocked By, unknown-count Child and closed Blocked By: verify the
  specific current/related IDs and relationship. Escape and Close must dismiss
  with visible focus returned to the invoking button; rows/counts stay unchanged.
  Closed buttons must not be Tab-reachable until their group opens.
- Check A/C at desktop width in all three themes and at 360 CSS px and desktop
  200% zoom in one theme. Exercise Tab/Shift-Tab, native Enter/Space, radio arrows
  and visible focus; informational rows should be skipped. Check complete
  IDs/titles, readable status and no horizontal overflow or clipping.
- Disabled search/add/save illustrations must not pretend to work. No browser
  check demonstrates actual unlinking or production confirmation behavior.

Record results separately from this checklist. Browser mockups cannot establish
Electron/Extension Host behavior, real-bd integration or production confirmation
policy. Application gates and package inspection do not render these mockups.

## Future implementation evidence matrix

Future enhancement needs implementation planning and assigned file owners.
This matrix describes future evidence, not implementation results.

| Story constraint | Falsifiable future evidence |
| --- | --- |
| Retain related stored status end to end | Mocha TDD unit/mapping fixtures with actual CLI field names: demonstrate current relationship model/mapper discards status; future contract retains known, missing and unrecognized values for all four relations. Check adapter/detail-reader response shapes by supported bd version. |
| Distinct link and unresolved-direct counts | Unit counterexamples: 33 links / 3 unresolved of current issue vs related open rows 2/0/unknown; do not reinterpret existing `blocked_by_count` silently. Assert effects on board-column placement and relationship badges separately; prove unknown is not zero. |
| bd blocking/readiness authority | Isolated real-bd fixtures verify open/in_progress/blocked/deferred/closed semantics, direct vs transitive edges, closed-parent/active-child behavior and the closed=resolved assumption. Compare with actual `bd ready`/blocking outputs; no competing local readiness algorithm or guessed not-ready cause. |
| Unknown / partial / failure | Mapping and rendered fixtures for absent arrays vs genuine empty, count-only responses, missing/unrecognized status, unavailable counts, truncation, stale retained rows, failed CLI/detail refresh and readiness fallback warning. Loaded subsets must not imply complete totals. |
| Bounded loading | Adapter/detail-reader request-count and timeout/output-bound assertions: bounded detail reads, no initial-board per-card `bd show` N+1. Measure request budgets on large fixtures, cancellation and disposal. |
| Contracts and safe rendering | Schema `safeParse` tests using real payload fields and opaque custom/hierarchical IDs; DOMPurify on every innerHTML assignment even after escaping; preserve CSP/resources and safe error truncation. Adversarial title/ID fixtures must not execute markup. |
| Reused detail and stale responses | Real rendered tests for rapid issue/workspace switches, ignored stale replies and rebuilt DOM vs cached-node identity; remove old handlers on repeated opens; shared dirty/discard source of truth for create/edit, without a duplicate form. |
| Keyboard Unlink and mutation safety | Future production Enter/Space activates only the focused Unlink button with an accessible relationship/opaque-ID name; verify closed controls after expansion, focus return and one handler per action. Unlink removes the relationship, never deletes either issue; no Blocks removal is added. Decide real confirmation policy separately. Unit/schema and real Extension Host checks enforce read-only mode and shared dirty/discard protection before mutations, including rejected operations and stale detail replies. |
| Production / visual harness parity | Compare production and duplicated harness dialog markup/control attributes and fixture semantics. Chrome mock evidence alone cannot prove host messages or Electron restoration. |
| UI lifecycle / accessibility | Render every status and edge case at light/dark/high contrast, 360 px/200% zoom; Tab/Shift-Tab, Enter/Space, arrows, focus, selection, scroll and expansion restoration. Exercise refresh, workspace changes, disposal, panel recreation and actual Extension Host restart separately. |
| Delivery gates | Future owner runs unit/mapping suites, isolated real-bd integration and rendered + real Extension Host checks; `npm run lint`, `npm test`, `npm run compile` separately, then actual VSIX listing with retained assets/licenses and mockup exclusion. `npm run verify` is not production compilation; skips are not passes. |

At implementation planning, verify editor coverage for `src/shared/**` and
host/shared files under the current operating policy, with one authorized editor
per file per step. Any required authority change belongs to a separately
human-directed agent-engineer session; these design references grant none.
Verify scope for pure TS UI helpers under `src/webview/` and routing of
filterMarkup/filterUniverse work to typescript-specialist. Refined Option B is
the selected design, not a production implementation or confirmation policy.
