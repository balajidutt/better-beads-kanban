# Backlog-only workflow

Read this procedure before planning, dispatching, performing or reviewing backlog-only operations. Also read the safe-mutation, sync and completion safeguards in `.opencode/instructions/beads-plan-handoff.md`; its implementation-approval prerequisite does not apply to backlog-only work. Backlog grooming, issue creation/enrichment, linking, prioritization, status changes and closure are distinct from implementation. Classify every backlog mutation as medium/high, obtain a reviewed Plannotator plan, and route its exact approved handoff from build to beads-manager. Plan cannot mutate or call a writer. A backlog-only approval does not authorize source edits, implementation, claiming, new state files, sync or publication, or lift the bootstrap pause.

## Approved handoff fields

- Action: create, update-existing, create-linked, link, prioritize, update-status, or close.
- Issue: exact IDs, or exact approved creation fields.
- No implementation: true.
- Field updates: individually authorized values or preserving additions.
- Preserve: title, status, assignee, priority, labels, parent/dependencies, external_ref, description and history unless explicitly changed.
- Approval source: exact approved text or user-confirmed artifact, not the latest archive.
- Readback: observable expected result and approved close reason when applicable.

An existing issue reference means preserve and update that issue, not create a duplicate. A linked follow-up means create the approved distinct item and relationship, not replace its parent's design. Ambiguous identity, release selection or relationship direction stops for the parent to clarify.

New backlog items use OpenCode actor attribution and remain unassigned unless an assignee is explicitly approved. A status change is not permission to overwrite ownership. No deletion is supported. Implementation closure still requires reviewed, verified main landing; administrative cancellation or duplicate disposition must be explicitly approved and must not claim implementation evidence. Release closure requires verified publication rather than merely all dependencies closing.

Use the main-database resolution, prewrite reread, minimal preserving updates, serialized calls, partial-failure handling and readback rules in beads-plan-handoff.md. Never initialize a worktree database or close indirectly through a merge helper. Return the exact applied/unapplied changes and then stop; build must not proceed to source work from this handoff.
