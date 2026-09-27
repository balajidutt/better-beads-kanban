# Shared core: Phase A architecture

## Provisional source boundary

`src/shared` is an extraction boundary within this extension, not a published
package. It owns the issue model, bd response mapping, injected list/show reader,
Node CLI execution, and pure tree construction. It must not import extension or
webview code. `npm run test:shared:boundaries` checks TypeScript import/export and
module-load syntax, resolves targets, and checks the browser graph with TypeScript
and esbuild.

Public surfaces:

- `src/shared/model.ts`: browser-safe issue types, validation and tree exports.
  Its transitive graph is checked without Node or DOM ambient types and bundled
  for a browser, with Node built-ins and VS Code imports forbidden.
- `src/shared/node.ts`: the public Node entry for the reader and CLI. The adapter's
  temporary mapping seam also goes through this entry, never implementation files.

The extension adapter remains the facade for VS Code configuration, logging,
discovery, watchers, writes and disposal. Shared code does not implement a terminal
application. Tests may import implementation modules for focused characterization;
production consumers must use the public entries.

## Compatibility at the facade

Extraction preserves the facade's existing behavior rather than normalizing it:
non-array list responses can produce an empty board with an adapter warning;
show results use the first item and preserve the existing missing-issue behavior;
field defaults and relationship direction remain those of the mapping functions.
Strict read validation is an opt-in contract for independent consumers. The
facade's existing methods remain available during migration, including mapping
seams exercised by characterization tests. Tree ordering, missing-parent behavior,
cycle handling and closed-parent/active-child visibility belong to the shared tree
contract and are covered by the existing treeBuilder suite.

## Independent verification

`test:shared` compiles only shared sources and their test graph, then runs Mocha in
plain Node with its TDD interface. There is no VS Code launcher or DOM mock.
The existing treeBuilder suite is included even while its import path remains a
compatibility re-export. Temporary emitted files live under `node_modules/.cache`
and are removed after the run.

`test:shared:integration` requires a real bd executable. It uses the existing
scratch-workspace helper to pin routing and verify database containment before
seeding fixtures. List/show assertions use the shared Node entry. CLI writes are
fixture setup only and target the scratch workspace. Missing bd is a failure.

The dedicated Linux CI job installs the official bd 1.2.2 amd64 release archive,
verifies the pinned official checksum manifest and then the archive against that
manifest. The existing OS/Node extension matrix remains separate.

## Checkpoint A packaging decision

Keep `src/shared` provisional until both extension and terminal experiments have
demonstrated the same useful contract. If both graduate, the preferred destination
is a private `packages/backlog-core` workspace package. At Checkpoint A, record the
decision from the extraction evidence before moving files again. Review evidence
from both consumers at Checkpoint B before committing to a maintained package.

CJS/ESM exports, package build outputs, workspace configuration and lockfile changes
are separate follow-up work. This extraction does not establish a publication or
versioning policy. Browser and Node entry points must stay distinct through that
decision; the browser surface must never acquire Node runtime dependencies.

## Execution evidence

Validation on 2026-09-23, against baseline `97d7fc9`:

| Check | Observed result |
| --- | --- |
| `npx tsc --noEmit` and `npm run lint` | Passed |
| `npm test` | 493 passing in VS Code 1.138.0, exit 0 |
| `npm run test:shared` | 62 passing on macOS and disposable Linux |
| `npm run test:shared:boundaries` | Passed on macOS and disposable Linux |
| `npm run test:shared:integration` | Passed on macOS and disposable Linux with real bd 1.2.2 |
| `npm run compile` | Passed |
| Extension JS bundle | 658,023 to 656,958 bytes |
| Board JS bundle | 213,939 to 213,938 bytes; no external imports |
| VSIX inspection | 37 files, 952.71 KB; no shared source, standalone shared output, tests or dependencies |
| Manual Extension Development Host smoke | Maintainer confirmed all four views, opening details, tree expansion/filtering, refresh, external-change detection, pagination, error reporting, and writing/closing issues; repository-switching failure deferred |

The Linux runs used `node:22-bookworm`, linux/amd64, Node 22.23.2 and the official
bd 1.2.2 release (`6c124203e`). The archive matched SHA-256
`8140098a51d3b81d5548d1c5e6db1a2d9930e5d141efe2a4bff7d079c4d321e8`,
verified against GitHub release metadata. Containers and anonymous dependency
volumes were removed. No macOS development toolchain was installed. These were
local disposable-container runs, not hosted GitHub Actions executions.

The extension test run emitted VS Code `DisposableStore` warnings despite exit 0;
their cause is not established here. Dependency installation reported nine audit
findings in the existing lockfile; no dependency updates were made.

The maintainer's initial read-only pass confirmed all four views, opening issue
details, tree expansion/filtering and basic refresh. Subsequent checks confirmed
external-change/watch behavior, pagination, correct error reporting, and the
ability to write and close issues.
Repository switching has a reported failure: the switch notification appears but
the open board does not update until it is closed and reopened. The maintainer
reproduced this in the feature-worktree Development Host and in the installed
extension with the main worktree open. The installed extension version was not
recorded; this is evidence of an existing issue, not an exact source-baseline
comparison. A one-off populated Kanban with empty other views was also reported
but not reliably reproduced. The maintainer deferred investigation and requested
a Beads backlog issue at closeout of this work, not during the extraction.
That follow-up is recorded as `bbk-a0n`, "Refresh the open board after switching
repositories" (P2 bug). No investigation or fix was attempted in this work.

The maintainer explicitly accepted Checkpoint A on 2026-09-23 and authorized
Phase B on the recorded evidence, with repository-switching investigation deferred.
The provisional source boundary stays in place through the terminal experiment.
Checkpoint B requires separate validation and acceptance; neither approval
authorizes commits, publication, or a production packaging decision.

## Retained CLI limitations

On bd 1.2.2, `show --json` supplies forward dependencies but omits comment bodies
and reverse-edge `dependents`. Full-card comments/children/blocks therefore remain
empty when absent in the response, matching the extension mapper. List snapshots
still supply parent/child and blocker relationships. The integration fixture
verifies stored comments separately during setup and reports omissions rather
than adding reads to the list/show contract. Supporting additional comment or
reverse-edge queries would require a separately reviewed API change.

Strict mode validates JSON and the issue-array envelope, not every optional field.
Compatibility retains field defaults, first-result show selection, duplicate
edges, zero-to-null estimates, and missing-status readiness behavior. The runner
retains a 30-second default timeout, decoded-string 50-MB-per-stream limit and
SIGTERM-only termination by default.

## Phase B shared API review

The runner accepts optional `signal` and `killGraceMs` inputs. The terminal opts
into cancellation and a 250 ms SIGKILL grace period; the extension supplies neither
option and retains SIGTERM-only behavior. Focused review found no default behavior
regression. Six additional shared subprocess tests cover cancellation/escalation;
all 68 shared tests and 493 extension tests passed after the addition. The final
extension run used VS Code 1.139.0 and emitted the same untriaged disposable-store
diagnostics. Browser tree behavior is unchanged.

Both consumers now use the public source entries. The import checker also scans
terminal application code, allowing only those entries plus the existing
UI-independent repository resolver and filter constants. Terminal dependencies
remain isolated from the root manifest and VSIX: final inspection found 37 files,
953.19 KB, with no terminal sources, dependencies, outputs or documentation.

The terminal rejects snapshots with more than 512 loaded ancestor links before
building a candidate projection. This bounds the existing recursive tree helper
without changing extension behavior. A failed refresh preserves the prior
snapshot. See [`terminal/README.md`](../terminal/README.md) for prototype evidence,
limits and the manual validation record.

The two consumers support the private-package recommendation: browser-safe and
Node-only entry points have held up, while the terminal build must bundle source
across the root CommonJS/package boundary. Promotion should define browser/Node
exports, CJS/ESM outputs, build order, workspace dependency ownership and lockfile
policy, then rerun consumer tests and VSIX checks. This remains a separately
approved packaging change; Checkpoint B is not a production-layout decision.

## Checkpoint B acceptance

On 2026-09-23, the maintainer accepted the terminal as a proof of concept and
confirmed actual copy/paste in macOS iTerm. They reported that it functionally
does most of what they wanted, with UX improvements to discuss separately.
Manual Linux acceptance and the full item-by-item manual checklist remain
unverified; automated Linux PTY evidence is recorded separately. Acceptance does
not authorize commits, pushing, publication, or a packaging migration.
