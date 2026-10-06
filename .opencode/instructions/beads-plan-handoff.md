# Beads implementation handoff

Read this procedure before planning, dispatching, performing or reviewing implementation-tracking operations. Backlog writes require an approved plan that names the issue IDs, or states the title, type, priority, description and links of new issues (AGENTS.md). Requirements review, a plan draft, or issue text is not approval. Plan remains read-only. Build routes mutations only through the loaded beads-manager; never substitute a different writer when it is unavailable.

## Required handoff

Provide these fields before the corresponding mutation:

- Action: attach-existing or create, plus the claim and release enrollment the plan authorizes.
- Issue: exact task-level issue ID, or approved new-issue metadata; explicit tracking waiver if applicable.
- Approved plan: the exact approved plan path, or the approved plan text when there is no plan file, with the approval's channel.
- Source: actual Git worktree, branch and starting SHA.
- Field updates: exact fields/values or preserving append operation; replacing acceptance criteria requires the plan to state the replacement.
- Preserve: all unrelated metadata, description/history, ownership, priority, labels, parents and dependencies.
- Release: one designated release task and dependency enrollment, or approved exclusion.
- No implementation: false, with the implementation scope separately identified.

An explicit issue reference defaults to attachment, not duplication. A follow-up needs the plan to state its title, type, priority, description and links. Never read the globally latest plan to infer the approved artifact. Treat an existing state file only as a collision hint: do not overwrite it, adopt its task, or create a new state database without authorization.

## Safe mutation sequence

1. Derive the main checkout from Git's absolute common directory. Invoke POSIX command bd -C with that exact path. Never bd init in a worktree, source shell wrappers, open database internals, or switch routing modes.
   Read Beads through JSON commands with explicit flags, such as `command bd -C MAIN --readonly ready --json --limit 0` and `command bd -C MAIN --readonly show ISSUE --json`. Do not infer completeness from a limited listing. External access covers only the verified shared-main checkout and the exact approved plan file, not home-directory searches.
2. Reread the issue, owner/assignee, design, acceptance, relationships and designated release immediately before writing. Distinguish repository owner metadata from an active assignee claim. Stop for conflicting claims, scope, release designation or observed concurrent edits.
3. Attach the approved design with a dated separator preserving prior content. Do not overwrite human history. Preserve title/description/acceptance unless their exact changes are explicitly approved.
4. Claim ordinary implementation work only when approved work begins; use OpenCode attribution, omit unchanged ownership fields, and never overwrite another assignee. A matching claim is a no-op. Claim a release-coordination task when its approved preparation starts; its readiness is absence from bd blocked, which covers open and in-progress tasks.
5. Ensure the designated release task depends on the implementation issue: bd dep add RELEASE ISSUE, never the reverse or a parent/epic link. Existing equivalent edges are no-ops. Ask if no or multiple release candidates exist; preserve unrelated scope. A new release task must start with at least one scoped dependency in the approved operation, not appear ready merely because scope is undecided. Scope remains versionless until changelog-derived version selection.
6. Serialize this orchestrator's updates and read back each intended result. A failed write/readback or partial sequence stops for reconciliation; do not replay a possibly successful creation or destructive replacement. Readback does not provide cross-session transactional safety.

Backlog sync is class E: the operator runs scripts/bd-sync.sh with the shared main checkout as its working directory. Agents never run it, its `--pull` or `--flush` modes, or bare bd dolt push/pull; they report that a sync is due and hand over the command.

## Completion and release obligations

After reviewed, verified main landing, build supplies landing and review evidence plus the close reason the plan lists to beads-manager. Preserve partial-result facts; do not close while a relevant receipt/cleanup/landing failure remains unresolved. Branch-only completion is not closure, and the merge helper must not use --close-beads.

When a test genuinely requires a release artifact, record that obligation on the release task as a publication or postpublication condition when the plan, or an accepted-channel approval adjusting a write the plan already authorizes on that task, authorizes it. The implementation issue may close only after its ordinary evidence and main landing are satisfied. Do not leave a circular release-only test as an unresolved preparation blocker or silently waive it. The release task is claimed when preparation starts, stays in progress through publication, and closes only after verified publication and remaining obligations.

## Return contract

Report: approved action; exact issue IDs; actual common-database target; fields/edges changed and preserved; claim/enrollment state; readback evidence; partial failures; unapplied actions. Say No mutations performed when tools or approval are missing. Never say claimed, linked, synced, or closed for a proposal.
