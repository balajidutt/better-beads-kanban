@AGENTS.md

# Claude Code adapter

These additional instructions apply only to Claude Code. Shared repository policy and technical-reference routing live in `AGENTS.md`; do not duplicate them here or translate `.opencode` paths into `.claude` paths.

Resolve references using their literal on-disk paths. If supplied context names a nonexistent translated path, reread root `AGENTS.md` and follow its actual links; do not reconstruct the missing procedure.

## Ordinary commit attribution

After approval of the message and intended files, prefer `cc-commit` for Claude-executed commits. It is maintainer-provided, not shipped in this repository. On native Windows use `cc-commit.ps1` from PowerShell when installed; the `.cmd` stub cannot preserve multiline arguments.

If the wrapper is absent, [Portable commit attribution](CONTRIBUTING.md#portable-commit-attribution) contains the Claude identity-only fallback. It sets both author and committer, adds no attestation trailers, and does not consume the wrapper's optional handoff state. Use it only when this Claude session's higher-priority policy and actual permissions permit it; otherwise give the human the exact approved command. It is not an OpenCode exception or a substitute for guarded merge/release tooling.

Verify both author and committer after an authorized commit. No approval is implied by an available wrapper or documented fallback.

This adapter does not override higher-priority harness instructions. If those conflict with the Claude-only attribution procedure, stop for human reconciliation.

Show exact targets and effects for approved operations. Do not compose commands in ways that hide an additional operation or its separate approval requirement.

## Runtime compatibility

`.claude/settings.json` owns the Claude SessionStart Beads-priming hook. Importing shared Markdown does not replace or validate that hook. Follow the explicit shared-main targeting rules regardless of any successful automatic priming.

OpenCode's agent permissions and plugins are not Claude runtime controls. Use the capabilities actually available to this Claude session and the shared approval/review procedures; do not impersonate an OpenCode specialist or claim equivalent enforcement. Escalate missing review, tooling, or ownership instead of bypassing it.
