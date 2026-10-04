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
| plan-reviewer, code-reviewer, test-strategist | `anthropic/claude-opus-5-5` | high | Unset |
| beads-manager | `openai/gpt-5.6-terra` | high | Unset |
| typescript-specialist | `openai/gpt-6-sol` | high | Unset |
| webview-specialist, release-manager, ci-build-engineer | `openai/gpt-6-sol` | high | Unset |

The user requested temperature 0.4 for plan, 0 for reviewers and 0.2 for specialists. Unsupported numeric overrides are omitted; inherited values may still appear in resolved configuration even when a model capability gate suppresses them. Schema validity, advertised capability and response identity do not prove provider-effective sampling. No silent model fallback is allowed. Cross-provider review is an intention, not a permanent guarantee if global bindings change.

## Request lifecycle

1. Default build with no exact approved handoff performs no mutation or mutating dispatch. Ask the user to select plan; clearly labeled read-only analysis is still possible.
2. Plan reads only the applicable procedures and source. It obtains an evidence strategy for behavior changes. A Simple change must meet every small-change condition: one file, at most 15 changed lines, no design/architecture decision and clear scope. Authority, dependency, security, release and backlog decisions are not Simple merely because their text is short.
3. Medium/High work gets a complete draft, written adversarial self-critique, independent plan-reviewer challenge and revised submission through `submit_plan`. Missing review/submission capability blocks approval readiness.
4. Requirements approval or an issue description is not implementation approval. The approved handoff identifies exact scope, issue/waiver, source worktree/branch/base, owners, acceptance/evidence, allowed side effects, and release enrollment/exclusion. Never select the globally newest plan.
5. Build validates that handoff, routes required tracking through beads-manager, then assigns source work. The implementation owners write and run tests; strategist output alone is not executed evidence.
6. Code-reviewer inspects the whole intended current change, including untracked files, docs, locks and generated outputs. Any correction or hook-induced authored change requires renewed review. Incomplete coverage cannot pass.
7. Commits, landing fetches, main updates/merges, ref publication/deletion, sync, closure, real release runs and hook operations keep their distinct approvals. A reviewed implementation does not authorize these actions implicitly.

If annotations, denial, a pause or a scope conflict arrive at build, stop continuation and request the appropriate planning handoff. A specialist return can continue only the still-valid original scope; it cannot expand approval or override intervening feedback. Product decisions return to plan; agent-authority decisions return to the human-directed agent-engineer.

The common [Permission-aware recovery](../../.opencode/instructions/development-lifecycle.md#permission-aware-recovery) rule applies across OpenCode roles. An invocation rejection can permit recovery through approved, permitted commands or equivalent tools, including already-authorized mutations, without expanding scope or bypassing a required mechanism. Explicit handoff, role and procedure stops still govern. After a terminal stop, report known effects, compliance and missing evidence in text; continuation requires separately scoped human reconciliation. This refinement adds no Claude-adapter enforcement or runtime-parity claim.

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

The bash maps in `.opencode/opencode.jsonc` are generated. Edit `.opencode/permissions/spec.mjs`, which holds the named deny blocks and each role's fallback, exact rules and exceptions, then run `node .opencode/permissions/generate.mjs`; it rewrites only the bash maps and leaves every other key as written. `--check` reports drift without writing, and a tooling test fails when the configuration differs from a fresh generation, so a hand edit to a bash map fails CI. The generator and tests parse the file as plain JSON, so it carries no comments despite its `.jsonc` name.

Bash permissions use two defaults. Plan, build and agent-engineer deny any command their rules do not name. Beads-manager, typescript-specialist, webview-specialist, ci-build-engineer, release-manager, plan-reviewer, code-reviewer and test-strategist default to `ask` and end with explicit deny blocks, because models issue habitual shell forms (`ls`, `git -C <path>`, reordered flags) that no exact-form list anticipates. Under OpenCode's `--auto` mode, which approves every request no rule denies, an `ask` runs without a prompt. For those eight roles the deny rules are the enforced boundary, and an `ask` elsewhere in this document means the model's contract decides, not a human.

Each of the eight denies the common forms of Git commands that commit, push, pull, discard work or rewrite history: `commit`, `push`, `pull`, `reset`, `clean`, `restore`, `checkout`, `switch`, `stash`, `rebase`, `merge`, `tag`, `update-ref`, `filter-branch`, `filter-repo`, `config`, `gc`, `prune`, branch deletion, forcing or renaming, and AoE-owned worktree add, move, remove and prune. Each Git deny is written four ways (`git X`, `git * X`, `command git X`, `command git * X`) so options such as `-C <path>` or `-c` before the subcommand do not bypass it. Main and tag pushes are therefore human-run.

Each role also denies every `gh` command except release-manager's three postpublication reads; publication (`npm publish`, `vsce publish`, `npm run release:package` and `release-fork-vsix.sh`, which the human runs); dependency installs other than CI's exact `npm ci --ignore-scripts`; Beads subcommands outside the backlog procedure, which change storage, history, configuration, claims or remotes, sync with external trackers, start a server or open an editor (`init`, `dolt`, `sql`, `sync`, `purge`, `serve`, `edit` and the rest of the `bd(...)` list in the spec); shell wrappers (`sh`, `bash`, `zsh`, `eval`, `sudo`); any command naming a `.env`, `.ssh` or `.beads` path (the name after a space, `/`, `=` or a quote) or containing `auth.json` or `.npmrc`; and destructive system commands.

Roles other than CI deny `oc-commit`, `cc-commit` and the merge helper. Roles other than beads-manager deny `bd-sync.sh` and every bd command except their exact `--readonly` and help forms.

The three review roles also deny the common forms of Git index and ref changes (`add`, `mv`, `rm`, `apply`, `am`, `cherry-pick`, `revert`, `notes`, `fetch`, `branch` other than their named reads, `--output`), npm, npx, node, installed package binaries, repository scripts and helpers under `scripts/` and `assets/`, python, perl, ruby and `patch`, common file-writing commands, and `curl` and `wget`. They review evidence and do not run code.

The deny list stops accidents by a cooperating model; it does not contain one that works around it, and no list covers every spelling. OpenCode matches each simple command separately, including inside `$(…)`, but forms such as `env X=1 git push` or a file write through `node -e` in an executing role fall outside the patterns. A broad pattern can also deny harmless text: `git log -S push` is denied for every role, and beads-manager's `command bd -C <main> --readonly list --label sync` is denied while `--label=sync` is not. Bash does not apply the read tool's protected-path denials, and zsh glob qualifiers can execute code inside an argument. Read, Glob and Grep remain the preferred file inspection. OpenCode 1.18.31 has no list tool, so no role has a `list` permission.

Every bash map has a `*>*` deny after its allows, which denies a redirection written on a simple command; grouped, piped or command-less redirections are not caught by the rules. CI's `oc-commit *` and `git log -1 *` and beads-manager's create, update and close rules follow it as `ask`, because their text can legitimately contain `>`. Those three rules also match any denied bd command that has `create`, `update` or `close` as an argument, so `bd worktree create`, the one denied subcommand of that shape, has its own deny after them. An argument value re-admits a denied command the same way (`command bd -C <main> delete bbk-1 close` asks), and that last deny also refuses create, update or close text containing `worktree create` followed by a space. Both are narrow.

Only CI has a project-configured install grant, the exact `npm ci --ignore-scripts` as `ask`; build routes dependency preparation to CI as the common lifecycle describes. The roles that run gates (typescript-specialist, webview-specialist, CI and release-manager) may run the exact `node --version`, and CI also `python3 --version`, to record the toolchain with their results; no version command with extra arguments has an allow rule.

Supported metadata-query families reduce prompts without becoming general shell grants. Every read-only git rule also has a copy with `--no-optional-locks -c core.fsmonitor=false` before the subcommand and the same action, so a model that carries the guard options from the status form onto a diff or log is not denied; a tooling test checks both forms resolve alike. `git rev-parse *` is available only to its designated roles; guarded status uses `git --no-optional-locks -c core.fsmonitor=false status` and supported query arguments. Do not append shell chains, substitutions, redirections or wrapper/interpreter bypasses. Wildcard string matching alone does not validate a command. CI's exact documented staged-comment audit is the sole pipeline exception.

OpenCode 1.18.31 checks the commands inside that pipeline separately. CI therefore has an `ask` entry for its parsed grep filter as well as the full-pipeline entry; the operation remains only the exact long form in the CI contract, after final staging. No generic grep family or other role receives this grant. The matcher normalizes backslashes and treats regex stars as permission wildcards, with no literal-star escape: an altered command containing extra quoted filenames, even protected paths, can match. Bash does not inherit the read tool's path denials. Read the entire permission request and use one-time approval only, never Always, which can add broad `grep *` and `git diff *` rules to the instance. Rejection stops the operation; an accidental reusable grant invalidates that run and requires closing only the standalone instance, fresh startup and renewed approval. Do not treat these behavioral restrictions as a parser sandbox or bypass a denial through another tool.

The commit executor must read every staged-diff hunk and audit result, using successive reads of a complete tool-output artifact when display output is truncated. It reports actual file/range coverage rather than inferring completeness from a suffix. The audit runs only after the final index is assembled; an earlier audit does not cover later restaging. A pipeline exit code alone does not prove the Git producer succeeded.

After a terminal stop or an invalidated run, in-flight or completed work is not undone. Report already-observed index/HEAD effects and mark later state unknown; do not run status or diff after stopping. A new instance is not permission to repeat a completed commit.

Beads-manager and CI may run the exact `git worktree list --porcelain` query. Plan, beads-manager, code-reviewer and release-manager check installed CLI help only through exact rules, `command bd --help` and `command bd <subcommand> --help` for each bd subcommand the role may run; a help wildcard would also match `command bd close <id> --reason --help`, which closes the issue.

Code-reviewer has release-manager's `ask` history and range-diff families, placed before its exact inspection allows so those stay prompt-free, plus `git rev-parse HEAD` and `--readonly` bd `show` and `dep list` reads, so it can check release scope independently. Release-manager may run `git branch --show-current`, `git ls-files *` and `git merge-base --is-ancestor * *` without a prompt; running the release helper script is denied to it, while inspecting the script with these and the range forms is not. Its fresh-main and remote-tag `git ls-remote` queries and its three postpublication `gh release` queries against `balajidutt/better-beads-kanban` ask; none writes a file. The beads-manager, code-reviewer and release-manager contracts name the exact Git forms each role uses, and a tooling test resolves every named form against this configuration, so a named form the rules deny fails CI.

Release-manager's and code-reviewer's history and diff families (`git log --oneline --decorate --reverse *`, `git diff --no-ext-diff --no-textconv *` and its `--stat`/`--name-status` forms) are `ask`, because the wildcard accepts any arguments. `--output=<file>` writes a file, `--no-index` compares arbitrary host files outside the repository, pathspecs can name protected files, a later `--ext-diff` or `--textconv` re-enables drivers, and `git log` runs textconv drivers for patch output (`-p`) and `-S`/`-G` searches unless `--no-textconv` is present. The bash external-directory check does not inspect git arguments.

Read the full request and approve once; Always would store `git log *`, `git diff *`, `git ls-remote *`, `gh release view *` or `gh release download *`. These families sit before the exact allowed `git diff --no-ext-diff --no-textconv`; OpenCode applies the last matching rule and a trailing ` *` also matches the bare command, so the exact diff stays prompt-free only while it comes later.

Protected read paths also constrain grep, diffs and shell inspection. Inventory paths before broad content access; report accidental exposure only by path. External-directory ask for manager covers verified shared-main and exact approved artifacts; for CI/release it covers approved authoritative tooling/source checkouts. It does not authorize unrelated host work. Every workflow role may read the whole Plannotator plans directory, `$HOME/.plannotator/plans/`, and OpenCode's tool-output directory; other external paths keep the role's `deny` or `ask` default. The plans directory holds every project's approved, denied and annotation files, and the permission cannot narrow it by filename, so roles read only the exact plan path their handoff, dispatch or Plannotator result names. Each external-directory map starts with that `*` default so inherited grants from global configuration do not survive merging, unless a global map for the same role lists its own `*` ahead of a grant. Edits outside the worktree stay denied by each role's edit rules. Approved large design payloads are inert transport data: preserve original issue fields, reread immediately before writing and verify afterward.

OpenCode 1.18.31's Grep does not apply the read tool's path denials. `.gitignore` keeps credential and local environment files out of a directory-wide Grep, but a Grep whose `include` glob names one of those files overrides ignore rules, so the restriction there is policy, not enforcement. Every credential pattern in `.gitignore` also needs a `.vscodeignore` counterpart: release preflight accepts ignored untracked files, and vsce packages by `.vscodeignore` alone.

Permissions are not an OS sandbox. Global/project/plugin/session ordering, custom tools, stored approvals, startup behavior and OpenCode's tool-output-directory exception need separate effective-runtime inspection. Configuration review and mocked permission tests do not establish every denial is enforced. Revalidate after relevant global, plugin, runtime or provider changes; never widen authority just to obtain a green check.

### Recovery and stop boundaries

Plan-reviewer, code-reviewer and test-strategist are denied the common forms of commands that change files, Git state, dependencies, the backlog or releases, so their dispatches carry no stop-on-any-denial instruction. Under the lifecycle's read-only denial rule, a denied read is an error they report and route around with a contract-named form or Read, Glob or Grep; there is no recovery budget. Models reach for habitual shell forms such as `ls` or `git -C <path>` whatever the contract says, so a fatal denial would end reviews over reads the permission system had already blocked harmlessly. A review that cannot obtain the evidence it needs returns as incomplete. A denied call aimed at a protected path is never pursued through another tool, whichever tool's rule denied it, because Grep does not apply the read tool's path denials. A human rejection, or any denied call that is not a read, still stops the dispatch, and steps that can mutate state keep stop on any denial.

Evaluate eligible recovery by the authorized replacement sequence, preserved conditions/gates and lack of duplicated effects. Evaluate terminal-stop adherence by attempted calls after the candidate receives the stop condition. Mechanical enforcement concerns admission at the applicable authorization/stop boundary, not an unconditional halt after every denied invocation. Already-admitted in-flight work may finish; an abort before candidate receipt cannot demonstrate voluntary adherence.

In the inspected OpenCode 1.18.31 [permission service](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/permission/index.ts), rule denial produces `DeniedError`; human rejection produces `RejectedError` or, with feedback, `CorrectedError`. The inspected [processor](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/session/processor.ts) blocking branch handles `RejectedError` and question rejection, not every permission-error class. These distinctions alone do not determine whether a specific recovery is authorized. Neither a blanket abort nor indiscriminate continuation implements this policy. These are pinned-source observations, not installed-runtime verification or a proven cause of an incident.

The inspected [tool wrapper](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/session/tools.ts) reaches its after-hook after successful execution; thrown errors bypass that path. [Plugin event dispatch](https://github.com/anomalyco/opencode/blob/v1.18.31/packages/opencode/src/plugin/index.ts) does not await event-callback promises. An after-hook or observer alone is not an established per-operation enforcement gate. Caller/child propagation, concurrent admission, restart and guard failure remain unverified; no enforcement architecture is selected here.

Cross-role text review assumes the common instruction is supplied to each OpenCode role. The configuration's instructions entry is not proof of effective per-role prompt loading. Static installation checks must preserve that entry; separately approved runtime verification must establish the evaluated common text reaches each role before claiming deployed ten-role coverage. No running session acquires these changes merely because files were edited.

### Plannotator

The project registers `@plannotator/opencode@{file:~/.config/dotfiles/versions/plannotator}` with `workflow: user-managed`, `runtime: cli`, and planning-agent names `plan`, `plan-GPT-xhigh`, `special-builder`, `agent-engineer`. The latter names are inherited compatibility settings, not extra shipped roles or task routes.

The version file is an environment-local pin that dotfiles renders alongside the matching Plannotator CLI, so the plugin and the CLI run the same release. This repository does not choose or check that version. At startup OpenCode reads the file, trims it and substitutes the text into the plugin spec. `~/` resolves to the home directory of the user running OpenCode, not to the checkout. A missing file stops config loading with a `bad file reference` error, so provision it before starting OpenCode in any checkout of this repository. An empty file does not fail: it leaves the spec without a version, so the first install resolves the latest release and later startups keep that cached copy. Restart OpenCode after the pin changes; running sessions keep the plugin they loaded, and a new version can need the cache preparation described under installation below.

This mode registers `submit_plan` but leaves agent permissions and prompt policy to the repository. The plugin writes its own backing artifacts; that is not permission for plan to edit repository Markdown. Native configuration permits submission for plan and the human-directed engineer, denies build, and leaves specialists under deny-by-default. The review UI can still request an agent switch; the mode does not repair or disable that feature. Approval of a test fixture or requirements-only document never authorizes implementation even if a UI message suggests otherwise.

The following results are historical. They were recorded against the earlier exact pin `@plannotator/opencode@0.27.14` and have not been rerun with the dotfiles-supplied version. Fresh discovery on OpenCode 1.18.31 found one pinned registration and the intended resolved rules. A separate manual two-submission rejection/revision/approval exercise opened the browser twice, retained the no-implementation fixture and left repository hashes unchanged. These are configuration/functional observations, not proof of every outgoing prompt transformation, tool denial or provider parameter. The earlier source comparison covered the relevant unchanged 1.18.30/1.18.31 config/plugin/permission/tool paths, not every runtime dependency.

## Installation and rollout status

OpenCode loads configuration at process startup. For ordinary installation, start a fresh process after changes. Do not restart an AoE-managed session as a verification shortcut: leave it running with its previously loaded configuration and use a separately authorized fresh process in the same worktree. Verify exact directory/project identity, named candidate definitions, resolved permissions/models and relevant tool registration before claiming deployment. Keep caller-owned processes and sessions untouched.

An exact plugin pin can require cache preparation even when an `@latest` cache contains the same version. Review and authorize startup/dependency effects. The configuration-local `.opencode/package.json` and npm lockfile are maintained inputs, not disposable startup output. Install with `npm ci --ignore-scripts` from `.opencode/`; the root application has its own npm lock. Do not substitute Bun or copy installed packages between checkouts. Never copy credentials into fixtures or logs. Keep durable approvals outside disposable test directories; task-local payloads/reports are not permanent approval authority.

Historical shared-guidance checkpoint, before the checkpoint commit:

- Ten role definitions, three procedures and the pinned Plannotator correction are installed in the feature worktree, not committed or main-landed by this checkpoint.
- Shared policy, the Claude adapter, technical/workflow references, bounded consumer-document changes, and the `docs/development/**` VSIX exclusion are present but uncommitted in this worktree checkpoint. They belong to the separately approved post-bootstrap shared-guidance package, not an enlargement of the original bootstrap exception.
- The preserving implementation handoff is recorded in `bbk-nfx`; merge-adoption scope/acceptance is recorded in `bbk-c5f`; both block the designated release task. Issue reads remain necessary before later writes; this paragraph is not current ownership evidence.
- Review-loop plugins, the complete GitHub merge runtime/policy, stable-release preflight and worktree-safe Claude priming are later work packages. Do not claim their guards are active or use their prospective CLI flags.
- `.claude/settings.json` still contains the existing SessionStart hook. Its presence does not prove main/nested/external-worktree behavior. Changing or validating that hook needs its scoped approval.

Subsequent execution produced the 27-file branch commit `6eee91238fb5b0c61fb743b6033d075d2be760f1`, but failed operational acceptance by continuing after a rule-based denial. Preserve that history; neither the commit nor later source corrections establish compliant execution retroactively. See the [execution outcome](agent-evaluation.md#ci-execution-outcome-and-recovery-draft). Subsequent source implementation proceeded under separate human approval. Every future CI mutation still needs its exact current handoff and operation approval.

The workflow targets macOS and Linux/WSL. Record actually exercised hosts separately from supplied compatibility-oriented commands and Linux CI. Native Windows orchestration and interactive devcontainer support are not established. Application Windows CI coverage does not imply either.

### Review and lifecycle tooling

The three plugins in `.opencode/plugins/` share `.opencode/lib/review-loop.js` and `.opencode/opencode-tooling.config.jsonc`. The contract is exactly one terminal `BEADS_KANBAN_REVIEW_RESULT=PASS` or `BEADS_KANBAN_REVIEW_RESULT=FAIL`. The marker records changed paths and a per-session revision; the enforcer requests authorized parent review; the gate correlates the configured reviewer task with that revision before clearing the reminder. Edits during review retain the pending state. An acknowledged request suppresses duplicate delivery; uncertain delivery is retained without automatic replay. A confirmed rejection remains retryable.

Reminder state uses ignored `.opencode/.bbk-review-required.*.json` and `.opencode/.bbk-review-enforcer.*.json` files. Do not edit or delete these to manufacture approval. Generated/runtime paths are exempt from event marking; documentation, configuration, locks and workflow source are not. Event exemptions never narrow mandatory whole-change review. Missing events, watcher-to-session association, writable state and synthetic reviewer output remain limitations: these plugins are not authenticated, digest-bound approval or a stop-boundary enforcement system. No reminder overrides a pause, missing handoff or a leaf's nondelegation rule.

Fresh-process activation and manual qualification are separate from mocked plugin tests. Check edit/delete/move marking, parent/child routing, a failed review, edits during review, delayed/failed delivery and disposal in an explicitly authorized session. Do not revive the historical optional pilot merely to install this baseline. See [testing](../../TESTING.md#workflow-tooling) and [source provenance](tooling-provenance.md).

The global `worktree-merge` skill is not shipped here. Use it when the harness requires it; otherwise follow the repository merge procedure with the verified main-authoritative helper. This optional-skill prerequisite also applies to the CI leaf, but does not add tool permissions or relax helper/CI/approval gates. A stricter harness still blocks execution if its required skill is unavailable. Missing or feature-only helpers require the specific approved restoration/bootstrap/human path, never an improvised reconstruction. Once CI-gated mode is selected, failure cannot become local-only mode. GitHub evidence is selected-workflow success for exact repository/workflow/SHA/ref/push-event/run/attempt, respecting newer attempts; no job-count approximation, old-green substitution, override or automatic rerun.

`oc-commit` and `cc-commit` are maintainer-provided wrappers, not contributor prerequisites. Global attestation producers and their wrapper handoffs remain external: they record self-asserted participation/provenance, not approval of the exact current diff. This repository neither vendors their collectors/state/schema nor requires source-pair completion. The portable fallback sets author and committer only; it does not add trailers, consume attestation state or reproduce full wrapper behavior. Actual harness policy and tool permissions control whether an agent may use it. This repository's current OpenCode CI command profile does not permit native fallback commits or raw manual merges; missing required tooling means a human handoff, not another tool route or a permission edit.

Feature preparation publishes the exact SHA to its same-named feature ref. Landing requires separate approval for main/fetch and the mandatory exact-lease feature deletion attempt; omit `--close-beads`. Exact final/batched main may require separately approved reserved-ref CI. Partial landing/receipt/cleanup failure is reported without remerge or rollback. An existing pre-push hook without main's policy/runtime is not an active guard. Actual-clone validation and AoE cleanup remain separate.

Stable preparation/publication follows RELEASING and the executor contract. A ready scope permits preparation, not publication; prepared source must pass review/verification and main landing before publication selection. Older remote-main ancestors are permitted when metadata and history-backed scope match; missing ancestry/history is not permission to fetch automatically. The maintained release wrapper anchors `release-preflight.js` and the locked VSCE binary to the reviewed tooling checkout while using the selected source as CWD. Source availability alone does not authorize a real dry run or publication. Local branch VSIX builds use `scripts/build-local-vsix.sh`, require approval for its temporary package edit, and leave upload/prerelease selection to the human.

Check the required release helper and flags before constructing or invoking a real release command. Missing guards or `--release-issue` capability mean stop, not “try the older script and see.” The release executor's prospective invocation applies only after those prerequisites hold.

### Claude session priming

The tracked Claude SessionStart command invokes `scripts/beads-session-prime.js`
through Node and `CLAUDE_PROJECT_DIR`. The helper resolves the session and tooling
checkout to the same Git common directory, verifies the shared-main target through
`bd context --json`, and invokes `bd -C MAIN --readonly prime --hook-json`. Hook
stdin/stdout are preserved; inherited Git/Beads routing is removed for subprocesses.
Missing CLI/database or foreign-repository input fails without initialization,
synchronization or issue mutation. `scripts/beads-session-prime.sh` is a POSIX
entrypoint to the same implementation. Fake-CLI main/nested/external-worktree tests
do not establish real Claude startup or native Windows shell compatibility.

## Backlog operations

These technical safeguards apply regardless of harness. OpenCode additionally routes every real write through beads-manager. Database readiness/state comes from CLI queries, never parsing Dolt/SQLite storage. The shared main checkout owns the backlog; no worktree initialization or alternate planning database is a repair.

### Shared-main and preserving updates

Resolve Git's absolute common directory as in [AGENTS.md](../../AGENTS.md#beads-and-worktrees), verify its relationship to main, then use a literal `command bd -C` target. Nested worktrees can discover main by upward walking; external ones may not. Neither placement is a permission to rely on implicit routing. Read-only JSON queries use explicit flags and complete listings when completeness matters.

Keep task approval distinct from backlog-only approval. Preserve existing title, description, notes, history, ownership, labels, priority, parent and relationships except exact authorized changes. Large preserving design updates may use a user-approved complete payload file with native `--design-file`; a plan-only file is not preserving. Verify the payload against the approved text and current values, reread before writing, serialize this parent's writes, and verify stored fields afterward. Stop stale/uncertain/partial results rather than blindly replaying them. This is not cross-session transactional locking.

Implementation closure needs reviewed, verified main landing and an approved reason; publication is not an extra general task-close condition. Release closeout additionally needs verified publication and transferred obligations. The release task is claimed when preparation starts and stays in progress through publication; its readiness is absence from `bd blocked`, which reports open and in-progress tasks alike. Enrollment is a blocking dependency from release to work, not a label or parent/epic relationship.

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
