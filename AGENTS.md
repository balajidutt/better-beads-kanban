# Agent Instructions

This project uses **bd** (beads) for issue tracking. Run `bd onboard` to get started.

## In a git worktree, read this first

`.beads/` is gitignored, so a worktree has no database and every `bd` command fails with `no beads database found`. **Do not run `bd init`** — it creates a second, empty backlog that syncs nowhere. Run against the main checkout instead:

```bash
command bd -C "$(dirname "$(git rev-parse --path-format=absolute --git-common-dir)")" ready
```

See the "Working in a git worktree" section of CLAUDE.md for the full picture.

## Quick Reference

```bash
bd ready                        # Find available work
bd show <id>                    # View issue details
bd update <id> --claim          # Claim work (sets assignee, sets in_progress)
bd create --title="..." --type=task --priority=2
bd close <id> --reason="..."    # Complete work
bd close <id1> <id2>            # Close several at once
bd dep add <issue> <depends-on> # <issue> is blocked until <depends-on> closes
bd dolt push                    # Publish the backlog to the remote
bd dolt pull                    # Fetch the backlog from the remote
```

There is no `bd sync`. Code and issues travel separately: `git push` moves code, `bd dolt push` moves the backlog, and neither does the other's job.

## Key Concepts

- **Dependencies**: issues can block other issues. `bd ready` shows only unblocked work.
- **Priority**: P0=critical, P1=high, P2=medium, P3=low, P4=backlog. Use numbers, not words.
- **Types**: task, bug, feature, epic, question, docs.
- **Storage**: `.beads/` is gitignored, but the issue data *is* tracked in git. It lives on `refs/dolt/data`, a ref that never appears in the working tree, which is why a fresh clone needs `bd dolt pull`.

## Landing the Plane (session completion)

1. **File issues for follow-up work** — anything discovered but not done.
2. **Run quality gates** if code changed: `npm run lint`, `npm test`, `npm run compile`.
3. **Update issue status** — `bd close` what finished, with a reason worth reading later.
4. **Run `git status`** and report what changed.
5. **Hand off** — what landed, what is staged, what remains.

**Do not commit, push, or run `bd dolt push` on your own initiative.** The default here is conservative: propose the commit message and the exact commands, then wait for the maintainer. Being asked to commit once does not carry over to the next change.

Two repo rules that outrank convenience:

- **Never let a commit land under the maintainer's git identity.** Use `cc-commit`, which sets Claude as author and committer. It is a dotfiles-managed wrapper rather than part of this repo, so a fresh machine may not have it — if `command -v cc-commit` comes back empty, inline what it does instead of falling back to bare `git commit`:

  ```bash
  env GIT_AUTHOR_NAME="Claude" GIT_AUTHOR_EMAIL="noreply@anthropic.com" \
      GIT_COMMITTER_NAME="Claude" GIT_COMMITTER_EMAIL="noreply@anthropic.com" \
      git commit -m "..."
  ```

  On native Windows the wrapper is `cc-commit.ps1`, invoked from PowerShell; the same-name `.cmd` stub refuses because batch cannot preserve multiline arguments. Either way, confirm with `git log -1 --format='%an <%ae>'` before moving on.

  Inlining is safe here only because `cc-commit` is a four-variable env prefix with no logic of its own. Do not generalize the habit — `scripts/release-fork-vsix.sh` carries real guards (GitHub account switch, verification, restore on exit) and must never be hand-rolled.

- **Embedded mode can silently stop creating Dolt commits** ([gastownhall/beads#5433](https://github.com/gastownhall/beads/issues/5433), open against bd 1.0.4; unconfirmed on newer builds). In that state writes land in the working set and never become commits, so nothing looks wrong: `bd show` and `bd list` return the new data, while `bd history <id>` answers "No history found", `bd dolt commit` answers "Nothing to commit." right after a verified write, and `bd dolt push` answers "Push complete." while the remote ref never advances. The reporter lost six days and 103 issues to it. This repo runs embedded mode, so after a push that matters, check the ref yourself:

  ```bash
  git ls-remote origin refs/dolt/data
  ```
