# OpenCode workflow

[AGENTS.md](../../AGENTS.md) is the shared policy. This reference explains the OpenCode adapter, rollout boundaries and repository backlog operations. It does not grant permission to execute a procedure merely because its command is documented.

## Roles and source of truth

The maintained runtime definitions live directly under `.opencode/`; there is no generator or parallel Claude agent suite. Root [CLAUDE.md](../../CLAUDE.md) imports shared policy and retains its harness-specific attribution rules. Claude compatibility does not mean OpenCode permission/plugin parity.

| Role | Responsibility | Boundary |
| --- | --- | --- |
| `plan` | Investigate, scope, obtain strategy and challenge, submit an approval-ready plan | Read-only primary; user selects it manually |
| `build` | Validate an approved handoff, assign owners, collect evidence and independent review | Runtime default; no file authoring or shell execution |
| `plan-reviewer` | Challenge scope, authority, dependencies and evidence before approval | Read-only leaf |
| `beads-manager` | Exact preserving backlog operations and readback | Sole real-backlog writer in OpenCode; no source edits |
| `code-reviewer` | Independent review of the complete intended change and actual evidence | Read-only leaf; no self-fixing or sentinel-as-authorization |
| `typescript-specialist` | Extension host, CLI adapter, schemas, root filter helpers and associated tests/docs | Bounded editor; not the backlog manager |
| `webview-specialist` | Vanilla JS/CSS, helpers under `src/webview/`, rendering/state evidence | Bounded editor; root filter helpers route through the parent to TypeScript |
| `test-strategist` | Falsifiable test/evidence design before behavior edits | Read-only; does not write or execute tests |
| `ci-build-engineer` | Operational build/CI/development tooling and separately approved Git execution | Not an agent-authority editor or backlog writer |
| `release-manager` | CHANGELOG/version preparation and separately approved packaging/publication | Not a backlog writer; local VSIX and stable release are different lanes |

Only the two workflow primaries delegate; the eight specialists are leaves. The pre-existing global `agent-engineer` is separately human-directed for agent authority, not an eleventh shipped worker or a build task route. The permissions-only compatibility entry does not add another prompt/model. Neither unrestricted `general` nor `special-builder` is a workflow escape route.

One named editor owns each shared file for each step. Build returns integration fixes, snapshots and authored changes to an authorized editor. Operational file permission does not authorize changing agent authority indirectly through plugins, startup hooks or dependencies.

### Model and effort declarations

Plan/build inherit their global model/provider. Plan additionally requests native OpenAI `reasoningEffort: high` for the currently approved inherited route; a provider change requires revalidation. Build inherits its reasoning and temperature settings without local overrides.

| Leaf | Model | Variant | Local temperature |
| --- | --- | --- | --- |
| plan-reviewer, code-reviewer, test-strategist | `anthropic/claude-opus-5` | high | Unset |
| beads-manager | `openai/gpt-5.6-terra` | high | Unset |
| typescript-specialist | `opencode-go/kimi-k3` | max | Unset |
| webview-specialist, release-manager | `openai/gpt-6-astra` | high | Unset |
| ci-build-engineer | `opencode-go/deepseek-v4-pro` | high | 0.2 |

The user requested temperature 0.4 for plan, 0 for reviewers and 0.2 for specialists. Unsupported numeric overrides are omitted; inherited values may still appear in resolved configuration even when a model capability gate suppresses them. Kimi's max is an explicitly approved exception to high. Schema validity, advertised capability and response identity do not prove provider-effective sampling. No silent model fallback is allowed. Cross-provider review is an intention, not a permanent guarantee if global bindings change.

## Request lifecycle

1. Default build with no exact approved handoff performs no mutation or mutating dispatch. Ask the user to select plan; clearly labeled read-only analysis is still possible.
2. Plan reads only the applicable procedures and source. It obtains an evidence strategy for behavior changes. A Simple change must meet every small-change condition: one file, at most 15 changed lines, no design/architecture decision and clear scope. Authority, dependency, security, release and backlog decisions are not Simple merely because their text is short.
3. Medium/High work gets a complete draft, written adversarial self-critique, independent plan-reviewer challenge and revised submission through `submit_plan`. Missing review/submission capability blocks approval readiness.
4. Requirements approval or an issue description is not implementation approval. The approved handoff identifies exact scope, issue/waiver, source worktree/branch/base, owners, acceptance/evidence, allowed side effects, and release enrollment/exclusion. Never select the globally newest plan.
5. Build validates that handoff, routes required tracking through beads-manager, then assigns source work. The implementation owners write and run tests; strategist output alone is not executed evidence.
6. Code-reviewer inspects the whole intended current change, including untracked files, docs, locks and generated outputs. Any correction or hook-induced authored change requires renewed review. Incomplete coverage cannot pass.
7. Commits, landing fetches, main updates/merges, ref publication/deletion, sync, closure, real release runs and hook operations keep their distinct approvals. A reviewed implementation does not authorize these actions implicitly.

If annotations, denial, a pause or a scope conflict arrive at build, stop continuation and request the appropriate planning handoff. A specialist return can continue only the still-valid original scope; it cannot expand approval or override intervening feedback. Product decisions return to plan; agent-authority decisions return to the human-directed agent-engineer.

### Context on demand

The configuration's extra `instructions` list loads only [development-lifecycle.md](../../.opencode/instructions/development-lifecycle.md). OpenCode's normal AGENTS loading is separate; “one extra instruction” does not mean the common file is the entire system context.

- Implementation tracking: [beads-plan-handoff.md](../../.opencode/instructions/beads-plan-handoff.md).
- Backlog-only work: [beads-backlog-workflow.md](../../.opencode/instructions/beads-backlog-workflow.md), including its referenced preservation/sync/closure safeguards.
- Beads-manager reads both before writing and uses the actual operation's approval class. Backlog-only work does not need or grant source-implementation approval.
- Commit/merge planning, dispatch, execution and review read the [CI executor contract](../../.opencode/agents/ci-build-engineer.md), [portable attribution guidance](../../CONTRIBUTING.md#portable-commit-attribution), and [repository merge procedure](github-worktree-merge.md). Only the authorized executor loads the global merge skill when required by the active harness; the repository procedure does not require its installation for every contributor.
- Release operations read [RELEASING.md](../../RELEASING.md) and the [release executor contract](../../.opencode/agents/release-manager.md).
- Engineering roles read relevant [architecture](extension-architecture.md), [tests](../../TESTING.md), source and schemas—not every unrelated backlog/release procedure.

Missing text blocks the affected operation. Ask for the exact reference rather than reconstructing it. Reading another role's contract never grants its authority. Report which references were actually read; label supplied fixtures and unavailable runtime evidence.

## Permissions and practical limits

The project baseline denies known inherited broad tool maps and unknown tools, then restores explicit role capabilities. The primaries avoid a late per-agent wildcard that would override inherited-key allowlists after configuration merging. Their scalar edit denials replace inherited edit maps. Build has Bash denial; plan has only scoped query families and its three read-only task routes. Leaves deny task and unlisted tools.

Build's `unslop-commit` skill grant is for commit-message drafting guidance only; it is not authorization to bypass Bash/edit denial or perform a commit. CI has a separate grant for its approved commit procedure. A named skill grant does not prove the skill is installed. The global agent-engineer's authoring capabilities likewise depend on its actual inherited configuration, not the project's permissions-only compatibility entry alone.

Supported metadata-query families reduce prompts without becoming general shell grants. `git rev-parse *` is available only to its designated roles; guarded status uses `git --no-optional-locks -c core.fsmonitor=false status` and supported query arguments. Do not append shell chains, substitutions, redirections or wrapper/interpreter bypasses. Wildcard string matching alone does not validate a command. CI's exact documented staged-comment audit is the sole pipeline exception.

OpenCode 1.18.31 checks the commands inside that pipeline separately. CI therefore has an `ask` entry for its parsed grep filter as well as the full-pipeline entry; the operation remains only the exact long form in the CI contract, after final staging. No generic grep family or other role receives this grant. The matcher normalizes backslashes and treats regex stars as permission wildcards, with no literal-star escape: an altered command containing extra quoted filenames, even protected paths, can match. Bash does not inherit the read tool's path denials. Read the entire permission request and use one-time approval only, never Always, which can add broad `grep *` and `git diff *` rules to the instance. Rejection stops the operation; an accidental reusable grant invalidates that run and requires closing only the standalone instance, fresh startup and renewed approval. Do not treat these behavioral restrictions as a parser sandbox or bypass a denial through another tool.

The commit executor must read every staged-diff hunk and audit result, using successive reads of a complete tool-output artifact when display output is truncated. It reports actual file/range coverage rather than inferring completeness from a suffix. The audit runs only after the final index is assembled; an earlier audit does not cover later restaging. A pipeline exit code alone does not prove the Git producer succeeded.

Stopping an invalidated run does not undo an in-flight operation that already completed. Report actual index/HEAD effects; a new instance is not permission to repeat a completed commit.

Protected read paths also constrain grep, diffs and shell inspection. Inventory paths before broad content access; report accidental exposure only by path. External-directory ask for manager covers verified shared-main and exact approved artifacts; for CI/release it covers approved authoritative tooling/source checkouts. It does not authorize unrelated host work. Approved large design payloads are inert transport data: preserve original issue fields, reread immediately before writing and verify afterward.

Permissions are not an OS sandbox. Global/project/plugin/session ordering, custom tools, stored approvals, startup behavior and OpenCode's tool-output-directory exception need separate effective-runtime inspection. Configuration review and mocked permission tests do not establish every denial is enforced. Revalidate after relevant global, plugin, runtime or provider changes; never widen authority just to obtain a green check.

### Plannotator

The project pins `@plannotator/opencode@0.27.14` with `workflow: user-managed`, `runtime: cli`, and planning-agent names `plan`, `plan-GPT-xhigh`, `special-builder`, `agent-engineer`. The latter names are inherited compatibility settings, not extra shipped roles or task routes.

This mode registers `submit_plan` but leaves agent permissions and prompt policy to the repository. The plugin writes its own backing artifacts; that is not permission for plan to edit repository Markdown. Native configuration permits submission for plan and the human-directed engineer, denies build, and leaves specialists under deny-by-default. The review UI can still request an agent switch; the mode does not repair or disable that feature. Approval of a test fixture or requirements-only document never authorizes implementation even if a UI message suggests otherwise.

Fresh discovery on OpenCode 1.18.31 found one pinned registration and the intended resolved rules. A separate manual two-submission rejection/revision/approval exercise opened the browser twice, retained the no-implementation fixture and left repository hashes unchanged. These are configuration/functional observations, not proof of every outgoing prompt transformation, tool denial or provider parameter. The earlier source comparison covered the relevant unchanged 1.18.30/1.18.31 config/plugin/permission/tool paths, not every runtime dependency.

## Installation and rollout status

OpenCode loads configuration at process startup. For ordinary installation, start a fresh process after changes. Do not restart an AoE-managed session as a verification shortcut: leave it running with its previously loaded configuration and use a separately authorized fresh process in the same worktree. Verify exact directory/project identity, named candidate definitions, resolved permissions/models and relevant tool registration before claiming deployment. Keep caller-owned processes and sessions untouched.

An exact plugin pin can require cache preparation even when an `@latest` cache contains the same version. Review and authorize startup/dependency effects; do not adopt generated `.opencode` package/lock/ignore files silently. Never copy credentials into fixtures or logs. Keep durable approvals outside disposable test directories; task-local payloads/reports are not permanent approval authority.

At this shared-guidance checkpoint:

- Ten role definitions, three procedures and the pinned Plannotator correction are installed in the feature worktree, not committed or main-landed by this checkpoint.
- Shared policy, the Claude adapter, technical/workflow references, bounded consumer-document changes, and the `docs/development/**` VSIX exclusion are present but uncommitted in this worktree checkpoint. They belong to the separately approved post-bootstrap shared-guidance package, not an enlargement of the original bootstrap exception.
- The preserving implementation handoff is recorded in `bbk-nfx`; merge-adoption scope/acceptance is recorded in `bbk-c5f`; both block the designated release task. Issue reads remain necessary before later writes; this paragraph is not current ownership evidence.
- Review-loop plugins, the complete GitHub merge runtime/policy, stable-release preflight and worktree-safe Claude priming are later work packages. Do not claim their guards are active or use their prospective CLI flags.
- `.claude/settings.json` still contains the existing SessionStart hook. Its presence does not prove main/nested/external-worktree behavior. Changing or validating that hook needs its scoped approval.

The workflow targets macOS and Linux/WSL. Record actually exercised hosts separately from supplied compatibility-oriented commands and Linux CI. Native Windows orchestration and interactive devcontainer support are not established. Application Windows CI coverage does not imply either.

### Review and lifecycle tooling

The intended review-loop contract is exactly one terminal `BEADS_KANBAN_REVIEW_RESULT=PASS` or `BEADS_KANBAN_REVIEW_RESULT=FAIL`. The future marker/enforcer/gate must agree with the reviewer, but sentinel text is never authenticated, digest-bound approval. Mandatory independent review covers the whole diff whether or not a plugin event was observed. Missing events, stale/synthetic output and writable reminder state remain limitations to document.

The global `worktree-merge` skill is not shipped here. Use it when the harness requires it; otherwise follow the repository merge procedure with the verified main-authoritative helper. This optional-skill prerequisite also applies to the CI leaf, but does not add tool permissions or relax helper/CI/approval gates. A stricter harness still blocks execution if its required skill is unavailable. Missing or feature-only helpers require the specific approved restoration/bootstrap/human path, never an improvised reconstruction. Once CI-gated mode is selected, failure cannot become local-only mode. GitHub evidence is selected-workflow success for exact repository/workflow/SHA/ref/push-event/run/attempt, respecting newer attempts; no job-count approximation, old-green substitution, override or automatic rerun.

`oc-commit` and `cc-commit` are maintainer-provided wrappers, not contributor prerequisites. The portable fallback sets author and committer only; it does not add trailers, consume attestation state or reproduce full wrapper behavior. Actual harness policy and tool permissions control whether an agent may use it. This repository's current OpenCode CI command profile does not permit native fallback commits or raw manual merges; missing required tooling means a human handoff, not another tool route or a permission edit.

Feature preparation publishes the exact SHA to its same-named feature ref. Landing requires separate approval for main/fetch and the mandatory exact-lease feature deletion attempt; omit `--close-beads`. Exact final/batched main may require separately approved reserved-ref CI. Partial landing/receipt/cleanup failure is reported without remerge or rollback. An existing pre-push hook without main's policy/runtime is not an active guard. Actual-clone validation and AoE cleanup remain separate.

Stable preparation/publication follows RELEASING and the executor contract. A ready scope permits preparation, not publication; prepared source must pass review/verification and main landing before publication selection. Older remote-main ancestors are permitted when metadata and history-backed scope match; missing ancestry/history is not permission to fetch automatically. Until the approved source-targeting release guards exist, that planned execution path remains blocked. Local branch VSIX builds use `scripts/build-local-vsix.sh`, require approval for its temporary package edit, and leave upload/prerelease selection to the human.

Check the required release helper and flags before constructing or invoking a real release command. Missing guards or `--release-issue` capability mean stop, not “try the older script and see.” The release executor's prospective invocation applies only after those prerequisites hold.

## Backlog operations

These technical safeguards apply regardless of harness. OpenCode additionally routes every real write through beads-manager. Database readiness/state comes from CLI queries, never parsing Dolt/SQLite storage. The shared main checkout owns the backlog; no worktree initialization or alternate planning database is a repair.

### Shared-main and preserving updates

Resolve Git's absolute common directory as in [AGENTS.md](../../AGENTS.md#beads-and-worktrees), verify its relationship to main, then use a literal `command bd -C` target. Nested worktrees can discover main by upward walking; external ones may not. Neither placement is a permission to rely on implicit routing. Read-only JSON queries use explicit flags and complete listings when completeness matters.

Keep task approval distinct from backlog-only approval. Preserve existing title, description, notes, history, ownership, labels, priority, parent and relationships except exact authorized changes. Large preserving design updates may use a user-approved complete payload file with native `--design-file`; a plan-only file is not preserving. Verify the payload against the approved text and current values, reread before writing, serialize this parent's writes, and verify stored fields afterward. Stop stale/uncertain/partial results rather than blindly replaying them. This is not cross-session transactional locking.

Implementation closure needs reviewed, verified main landing and an approved reason; publication is not an extra general task-close condition. Release closeout additionally needs verified publication and transferred obligations. The release task stays open/unclaimed; in-progress tasks are excluded from `bd ready`. Enrollment is a blocking dependency from release to work, not a label or parent/epic relationship.

### Guarded sync

`.beads/` holds ignored working storage; issue data is published separately on `refs/dolt/data`. Code publication is independent. The installed helper is `scripts/bd-sync.sh`; run it only under separate sync authorization against the shared main checkout. Its basic modes are push, `--pull`, and explicitly opt-in `--flush`. Missing permitted execution capability blocks the operation; it does not authorize native Dolt fallback.

| Exit | Meaning and response |
| --- | --- |
| 0 | Verified push or verified already up to date |
| 1 | Verified stall; stop for a human |
| 2 | Unverified, including missing baseline or concurrent attribution; not proof of success or failure |
| 3 | Precondition failure; transfer was not performed |
| 4 | The bd invocation failed |

The guard addresses two distinct failure modes documented in [Beads #5433](https://github.com/gastownhall/beads/issues/5433): a transfer that does not advance the remote ref, and working-set writes that never become Dolt commits. A success-looking `Push complete.` message does not distinguish them.

Keep these helper invariants:

- Resolve the Dolt remote URL through `bd context --json`, not an assumed Git remote named origin. Dolt and Git remotes are separately configured.
- Compare actual refs. A working-set stall additionally needs issue count/newest `updated_at` versus unchanged Dolt head; equal Git hashes alone cannot detect it.
- Record a push baseline only when the advance is attributable to this run, using `refs/heads/__dolt_remote_info__`. A concurrent remote advance is not proof this machine published its writes.
- Do not write or backfill a baseline on unverified/up-to-date paths that could hide a pre-existing working-set stall. Missing evidence should cost an unverified result, not a false success.
- `--flush` is never automatic: it attempts to commit the whole working set, potentially including another client’s unfinished writes, and the affected upstream state can report “Nothing to commit.” incorrectly.

The expected remote identity is `git+ssh://git@github-balajidutt/balajidutt/better-beads-kanban.git`. Inspect through supported CLI queries; a renamed-owner redirect or another accessible SSH key can mask misconfiguration. Remote repair and URL-keyed cache maintenance are distinct, separately authorized administrative work. Do not remove/add remotes or delete storage/cache paths as routine sync cleanup.

### Fresh clones and routing

A genuinely fresh clone may lack the `.beads` directory required by the guarded helper. Initial database bootstrap is a separate maintainer operation: verify supported installed CLI behavior and the intended remote/database before approving it. Historical initial bootstrap used native `bd dolt pull`, but that is not a routine-sync escape, an authorization for the current OpenCode manager, or permission to initialize a worktree. If the supported bootstrap capability is missing, ask the maintainer to establish it; do not create an empty competing backlog. All subsequent routine sync uses the guarded helper.

`routing.mode` must remain `maintainer`. Under auto routing, contributor configuration can silently direct new issues into an unrelated planning database with another prefix. Verify the effective value with `bd config get routing.mode`, not `bd config list`: the latter can display stale database rows without the winning YAML pin. `bd config show` presents layers but is not the effective-value check.

The relevant layers are the repository YAML routing pin, Git's `beads.role`, and possibly stale database routing/sync rows. Do not unset the effective routing key merely to clean up an inert row: routing/sync keys are YAML-owned, so that can delete the pin and reactivate auto routing. Preserve the maintainer role and intended prefix; mismatches require human reconciliation rather than a second database. These are CLI-level checks, not permission to open protected `.beads` contents.

All linked worktrees share the same issue state immediately. A branch merge carries source, not a per-branch database; the issue ref is separate. Do not mistake local main landing for issue publication or native-main worktree resolution for an independent backlog.
