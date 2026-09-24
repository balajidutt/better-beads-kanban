# Releasing

How a backlog item becomes a shipped release, and how to cut one.

This fork is **not** on the VS Code Marketplace. It ships as a VSIX attached to a
GitHub release on `balajidutt/better-beads-kanban`. Upstream's Marketplace
runbook was removed in bbk-vi1; if you find instructions anywhere that mention
`vsce publish` or a publisher account, they are not this path.

[AGENTS.md](AGENTS.md) owns shared approval and identity policy. OpenCode also reads
its [release executor contract](.opencode/agents/release-manager.md). Preparation,
real dry runs, publication, and backlog closure are distinct approvals. Examples
below document procedures, not permission to execute them.

The guarded entrypoint is `scripts/release-fork-vsix.sh --release-issue ID`.
It anchors preflight and the locked packaging tool to its own reviewed tooling
checkout and uses the current directory as the selected source checkout. Require
the current clean main-authoritative helper; source implementation on a feature
does not authorize release execution or substitution of a historical helper.

## Accounts and remotes

The repo is owned by the `balajidutt` GitHub account, which is separate from the
account `gh` is normally logged in as. Two consequences:

- `origin` uses the `github-balajidutt` SSH host alias, not `github.com`, so a
  push resolves through that account's key rather than the machine default. The
  alias is a `Host` block in `~/.ssh/config`. On Windows there is no keychain,
  so run `ssh-add` on the key once per session or every push prompts for the
  passphrase.
- **You do not need to switch `gh` accounts by hand to cut a release.**
  `scripts/release-fork-vsix.sh` borrows the `balajidutt` identity for its own
  run and restores the previous active account on exit. It refuses to run if
  that account is not configured — a release's author is public and cannot be
  changed afterwards, which is the whole reason for the guard.

## How the backlog maps to a release

**Initial scope is versionless.** Do not preassign a release number in labels,
titles or fields. The release task is retitled only after changelog-derived version
selection below.

The semver level is an output of a release, not an input. You cannot know whether
a fix is a patch or a minor until you know what shipped alongside it and whether
the result is user-visible. `scripts/bump-version.js` already enforces that
ordering: it refuses to bump unless a `## [X.Y.Z]` heading already exists in
`CHANGELOG.md`. Write what shipped, then pick the number.

So scope lives in the dependency graph instead:

**1. The release is a bead.** Title it generically while the number is unknowable.

```bash
command bd -C "/absolute/main-checkout" create --type=task --priority=1 --title="Cut the next release"
```

Replace the path with the verified shared main checkout; do not initialize a
worktree database. OpenCode routes these approved writes through beads-manager.
Keep the release task **open and unclaimed** through preparation/publication:
`in_progress` is excluded from `bd ready`.

**2. Issues in scope get an edge into it.** The release depends on the work.

```bash
command bd -C "/absolute/main-checkout" dep add <release-id> <issue-id>
```

Add these as you decide, one at a time. Re-scoping is `bd dep remove`, not a
relabelling sweep.

**3. `bd show <release-id>` is the scope.** Exact and queryable. The release bead
stays blocked until every scoped issue closes, then surfaces in `bd ready` — the
cut signal is derived, not remembered.

A release bead with no edges appears in `bd ready` immediately. That reads as
"ship now" but means "scope undecided", so attach at least one edge when you
create it.

**4. At cut time, write the CHANGELOG entry from the release's blocking dependencies.**
Verify the installed CLI's JSON shape; inspected `bd show` output uses `dependencies`
records with `dependency_type: blocks`. Do not reverse the relationship or assume
a field named `blocks` contains the scope.
The dependency graph defines scope rather than `git log` alone. Writing the entry
tells you the level: breaking change → major, new capability → minor, fixes only
→ patch.

**5. Now the number exists. Retitle.**

```bash
command bd -C "/absolute/main-checkout" update <release-id> --title="Cut the X.Y.Z release"
```

**6. Bump and ship** (next section).

`bbk-gno` ("Cut the 2.2.0 release") is the worked example — it carries its scope,
its dry-run values, and the published sha256 in its close reason.

### Why not epics

Parent-child drives the Tree view's hierarchy (`src/webview/treeBuilder.ts`),
where it means work decomposition. A release epic parenting unrelated bugs would
overload that structure with a second, unrelated axis. Use `blocks`.

### Readiness, source selection and verification obligations

A nonempty designated release task appearing in `bd ready --json --limit 0` is the
signal to begin preparation. Do not require the yet-to-be-derived version, title
or CHANGELOG heading before preparation can start. Missing or ambiguous release
designation requires a human decision, not selection by recency.

Preparation changes must receive review, verification and main landing before
selecting the final publication source. The selected full SHA may be the current
fork remote-main tip **or an older ancestor**, including a detached source checkout.
It must already contain the matching prepared metadata and scoped work. Reconcile
ordinary repository history/diffs against the release scope; closed issues and
ancestry alone do not prove that an older source includes every scoped change.
Never silently remove dependencies to make the source appear ready.

Require a fresh remote-main query and local ancestry proof. Missing history stops
the operation; it does not authorize an automatic fetch, merge or push. Publication
approval names repository, full SHA, version, tag, Latest promotion, assets,
reviewed scope and remaining pre/postpublication obligations. Recheck near
publication and renew approval if those approved fields change. These are
point-in-time checks, not an atomic remote transaction or per-issue attestation.

Some tests genuinely need a release artifact. An explicit approved transfer records
that obligation on the release task as a publication or postpublication condition;
the implementation issue can then close after its ordinary verification and main
landing. Do not create a cycle where the release waits for a task whose only
remaining check needs the release. Prepublication-capable checks still run before
publication; genuine published-artifact checks must pass before release closeout.

### When to cut

There is no auto-update for a GitHub-release VSIX — every release costs a manual
reinstall on every machine. Cut when there is a reason to reinstall, not when
some number of issues have closed. 2.1.4-bd.4 → bd.5 shipped the same day and
bd.5 was pure repackaging; that is the failure mode.

## Cutting a release

### Preconditions

The wrapper and anchored `scripts/release-preflight.js` require:

- Clean tracked source, no unrelated untracked source files, and clean tracked
  release tooling in the same Git common repository.
- An open release task with a nonempty blocking scope and membership in the CLI's
  complete `bd ready` result, queried against verified shared main.
- Matching package/webview version and CHANGELOG heading; accepted versions are
  `X.Y.Z` and `X.Y.Z-bd.N`.
- A fresh GitHub main SHA and local proof that the source is its ancestor. Missing
  local objects block rather than trigger an automatic fetch.
- Confirmed absence of the local/remote tag and GitHub release, with query failures
  distinguished from HTTP 404 absence.
- No colliding target VSIX or `SHA256SUMS`, including ignored files and symlinks.
- An authenticated GitHub account and an executable locked VSCE in the reviewed
  tooling checkout.

Environment prerequisites, not all checked up front: Node 22+, npm and a checksum
utility (`shasum` or `sha256sum`). Prepare dependencies with lifecycle scripts
disabled. Neither the wrapper nor preflight enforces a Node minor-version check.

The wrapper pins its child process's `GH_HOST` to `github.com`, refuses
`GH_TOKEN`/`GITHUB_TOKEN` overrides and verifies its account switch/restoration.
Preflight repeats after build, comparing source/tooling SHAs,
scope and metadata against the initial snapshot and checking unexpected outputs.
Fresh main may advance only while retaining the selected source as an ancestor.
These are point-in-time guards, not atomic publication or proof that each closed
issue's implementation is present. History-backed scope reconciliation and the
explicit publication approval remain human/agent workflow obligations.

### 1. Write the CHANGELOG entry first

`release:bump` fails without a `## [X.Y.Z]` heading. Keep-a-Changelog format,
newest at the top; see existing entries for the category headings in use
(`💥 Breaking`, `✨ Added` / `Changed`, `🐛 Bug Fixes`, `🔧 Internal`,
`📚 Documentation`, `🧹 Cleanup`).

### 2. Bump

```bash
npm run release:bump -- X.Y.Z
```

Updates `package.json` and the cache-busting `const version` in `src/webview.ts`
in lockstep, and only after every check passes. The two must match or the webview
serves stale assets.

Accepted shapes are `X.Y.Z` and `X.Y.Z-bd.N` (the legacy fork series, kept so
those tags stay reproducible). The regex is duplicated in
`scripts/bump-version.js` and `scripts/release-fork-vsix.sh` — change one and you
must change the other.

### 3. Dry run

```bash
bash scripts/release-fork-vsix.sh --release-issue <release-id> --dry-run
```

Verifies, packages, and checksums without publishing, but creates local outputs and
temporarily switches GitHub identity; it is not read-only and needs separate approval.
Confirm the emitted `TAG` and `ASSET` look right. Historical packages were around
35–40 files and 1.25–1.35 MB; these are reference observations, not current test results.
Inspect the actual listing for unintended internal files and missing extension assets.
A count in the hundreds can indicate a bundling regression. A drift of a
file or two past the edges usually means something was legitimately added and
these bounds need widening, which is worth a moment's thought rather than a
shrug.

The printed sha256 is indicative only — VSIX zips are not guaranteed
byte-reproducible across runs. Take the authoritative value from the real run.

### 4. Ship

```bash
bash scripts/release-fork-vsix.sh --release-issue <release-id>
```

The script runs `npm run verify` itself (`tsc --noEmit`, `eslint`, the Mocha
suite), packages the VSIX, writes `SHA256SUMS`, creates the tag on the built
commit via `--target <full-sha>`, marks the release `--latest`, and uploads the
VSIX and `SHA256SUMS`.

For an older prepared source, invoke the absolute path to the approved main
checkout's wrapper with CWD at that source's linked worktree. Both checkouts must
share the Git common directory. The wrapper uses main's preflight and installed
VSCE, not the selected source's historical release script. Creating the source
worktree or preparing its dependencies requires explicit approval. Packaging
runs the selected source's normal prepublish build; review that source accordingly.

`SHA256SUMS` is load-bearing, not decoration. An installer that pins this
release by checksum can read the value out of a few bytes of manifest instead of
downloading the VSIX to hash it. Keep uploading it.

> **Trap: do not run `npm run release:package` for a fork release.** That is the
> Marketplace path (verify + `vsce package`, for a manual web upload).
> `release-fork-vsix.sh` does its own verify and package; running both just
> packages twice and can leave a stray VSIX behind.

The script also prints a pin block — tag, asset name, sha256, version — for
anyone installing this release from a pinned reference rather than from the
releases page. Nothing in this repo consumes those values.

### 5. Verify publication and account restoration

```bash
gh release view vX.Y.Z --repo balajidutt/better-beads-kanban
```

Check the tag resolves to the approved source SHA, `Latest` is set, both expected
assets are attached, and the published VSIX checksum matches the published manifest.
Verify the release author is `balajidutt` and the previous GitHub account was
restored; a trap's presence is not proof of restoration. Complete any transferred
postpublication checks. If upload, verification or restoration partly fails,
report actual state and stop; do not blindly republish, delete or recreate a release.

### 6. Close the release task

Only after the preceding evidence and remaining obligations pass, obtain closure
approval with a reason recording tag, source SHA and the actual published checksum.
OpenCode delegates that approved closure to beads-manager:

```bash
command bd -C "/absolute/main-checkout" close <release-id> --reason="Released vX.Y.Z from <full-sha>. Published asset sha256: <sha256>."
```

### Local iteration is a separate lane

`scripts/build-local-vsix.sh` produces a branch/SHA-marked local VSIX and temporarily
edits `package.json` while packaging. Approve those editing/build effects and use an
editing executor, not non-editing build. A blocked stable release task does not block
this local lane. Upload and prerelease selection remain manual; no new automated
upload or naming scheme is defined here. A local build or manual test upload does
not close the stable release task.
