# Contributing to Better Beads Kanban

Thanks for your interest. This is a single-maintainer fork, so PRs are welcome but
review is best-effort and may take a while. If you are planning something substantial,
open an issue first rather than building it and hoping.

## Getting Started

### Prerequisites

- Node.js 22 or higher for the full locked development/packaging toolchain
  (`.node-version` selects 22; extension tests also retain a Node 20 CI lane)
- VS Code 1.90 or higher
- Git
- [Beads CLI](https://github.com/gastownhall/beads) (`bd`) on `PATH`, or configured via
  the `beadsKanban.bdPath` setting

The extension shells out to `bd` for everything. Without it, the board cannot load and
the CLI-dependent integration suite skips; other suites still run.

### Fork, clone, install

```bash
git clone https://github.com/YOUR-USERNAME/better-beads-kanban.git
cd better-beads-kanban
git remote add upstream https://github.com/balajidutt/better-beads-kanban.git
npm ci --ignore-scripts
```

### Build and run

```bash
npm run compile
npm run watch
```

Compile builds the extension host and webview and copies dependency assets. Watch
rebuilds only the extension-host bundle; rebuild webview changes separately.

Press `F5` in VS Code to launch the Extension Development Host, then run
**Beads: Open Kanban Board**.

Read the seeding/cleanup scripts before using them and target an approved isolated
test database, never the repository's real backlog. See [TESTING.md](TESTING.md).

The extension icon is authored in `images/icon.svg`. `npm run build-icon` renders it
to `images/icon.png`, which is the file `package.json` points at. Edit the SVG and
regenerate; never edit the PNG by hand.

## Development Workflow

### Branches

`feature/`, `fix/`, `docs/`, `refactor/`, `test/` — pick the one that fits and add a
short slug: `fix/tree-connector-alignment`.

### Commits

Conventional Commits:

```
feat(table): add column reordering via drag-and-drop
fix(kanban): resolve card position after drag
docs(readme): update installation instructions
```

Types in use: `feat`, `fix`, `docs`, `style`, `refactor`, `test`, `chore`, `perf`.

### Portable commit attribution

Ordinary human-authored contributions use the contributor's own Git identity. The
following guidance is for commits executed on behalf of an AI harness, not a demand
that every contributor install the maintainer's dotfiles.

Prefer `oc-commit` for OpenCode and `cc-commit` for Claude Code when those wrappers
are available. They are not included in this repository. Their current installed
implementations also process optional attestation handoffs and trailers; the
fallback below deliberately preserves **only author and committer identity**.

Before committing, obtain approval of the intended files and message, complete the
applicable review/checks, and inspect the staged diff. Higher-priority harness rules
and actual permissions take precedence: if they require a wrapper, stop when it is
unavailable. The current repository OpenCode CI profile permits the wrapper command,
not the native fallback forms below; its fallback is an explicit human handoff,
not a permission change or invocation through another tool.

For an authorized human operator or another harness that permits it, these POSIX
examples set identity for the child Git process only. Replace the message placeholder
with the approved, safely quoted message. Do not add flags that override the selected
identity or bypass hooks/signing.

OpenCode identity-only fallback:

```bash
env GIT_AUTHOR_NAME="OpenCode" GIT_AUTHOR_EMAIL="noreply@opencode.ai" GIT_COMMITTER_NAME="OpenCode" GIT_COMMITTER_EMAIL="noreply@opencode.ai" git commit -m "<approved message>"
```

Claude Code identity-only fallback:

```bash
env GIT_AUTHOR_NAME="Claude" GIT_AUTHOR_EMAIL="noreply@anthropic.com" GIT_COMMITTER_NAME="Claude" GIT_COMMITTER_EMAIL="noreply@anthropic.com" git commit -m "<approved message>"
```

Neither recipe adds `AI-Participant`, `Source-Definition`, `Source-Digest`, model or
other attestation trailers. Do not synthesize metadata, read/delete pending wrapper
handoff state, or change Git configuration to imitate the wrapper. If the workflow
requires that full attestation contract, this limited fallback is insufficient:
use the required tooling or obtain a human handoff. Absence of such trailers is not
proof that a commit was human-authored. Normal Git hooks remain enabled and may have
their own approved metadata behavior.

Verify both identities after the authorized commit:

```bash
git log -1 --format='%an <%ae> | %cn <%ce>'
```

The commands above are POSIX examples, not PowerShell syntax. Use an installed
PowerShell wrapper where applicable, or a separately reviewed platform-specific
identity procedure. If no permitted procedure is available, stop and hand off to
the human. This does not establish native Windows OpenCode workflow support.

Contributors following the ordinary fork/PR path do not need the global
`worktree-merge` skill. For separately approved local-main landing, use the
[repository merge procedure](docs/development/github-worktree-merge.md); a missing
skill is not permission to bypass a required helper or CI guard.

The tracked merge policy, runtime and hook template do not install a Git hook.
Ordinary hook-free fork/PR contributions are unaffected locally. If you already
have a compatible global pre-push hook, the repository policy can activate it:
it requires checked-out main and its runtime before filtering refs, and the fixed
maintainer repository identity can reject fork-main pushes. Read the
[hook-impact notes](docs/development/github-worktree-merge.md#contributor-and-hook-impact)
before opting into this workflow; do not rewrite your fork's remote to bypass it.

OpenCode plugin dependencies are separate from the application. When working on
that integration, run `npm ci --ignore-scripts` from `.opencode/`, retaining its
own npm lockfile. OpenCode and global attestation tooling are not prerequisites
for an ordinary PR. Attestation is self-asserted participation/provenance, not
independent approval of the current diff.

### Before you open a PR

```bash
npm run verify
npm run compile
```

Verify runs type checking, lint, and the extension suite. Compile separately
exercises the production bundle. Local success does not establish every CI host
or exercise integration suites that were skipped.

Checklist:

- [ ] `npm run verify` passes
- [ ] `npm run compile` passes
- [ ] New behaviour has a test; bug fixes have a regression test
- [ ] [Architecture](docs/development/extension-architecture.md) or user-facing documentation (`README.md`) updated as applicable
- [ ] Screenshots for UI changes
- [ ] Breaking changes called out explicitly

Do not add a `CHANGELOG.md` entry in your PR. Entries are written at release-cut time
from the release's scope — see [RELEASING.md](RELEASING.md).

## Coding Standards

### TypeScript

- Use `unknown` rather than `any` in production code, with validation/narrowing before
  field access. The [architecture reference](docs/development/extension-architecture.md)
  describes the boundaries; assertions alone do not validate external data.
- Test files (`**/*.test.ts`, anything under `src/test/`) relax that rule — `any` is
  allowed there.
- `npm run lint` must pass with no errors. Style beyond what ESLint enforces: match the
  surrounding file.

### Layout

```text
src/
├── extension.ts            # entry point: commands, panel, message routing
├── daemonBeadsAdapter.ts   # all bd CLI interaction
├── beadsWorkspace.ts       # which folder holds .beads (no vscode import)
├── beadsWatch.ts           # file-watch globs for auto-refresh (no vscode import)
├── sanitizeError.ts        # scrubs CLI errors before they reach the webview
├── types.ts                # types and Zod schemas
├── webview.ts              # webview HTML, CSP, asset URIs
├── webview/                # UI: board.js, graph-view.js, treeBuilder.ts, ...
└── test/suite/             # Mocha tests
media/                      # styles.css, marked.min.js, purify.min.js
```

`beadsWorkspace.ts` and `beadsWatch.ts` deliberately avoid importing `vscode` so they
can be unit-tested without an Extension Development Host. Keep it that way.

### Security rules

[AGENTS.md](AGENTS.md#security-and-correctness) owns the mandatory security and
correctness rules. The short version:

- Every `innerHTML` assignment goes through `DOMPurify.sanitize()`, even for
  pre-escaped values.
- Every webview message handler validates its payload with a Zod schema before use.
- All flags go **before** the `--` separator in `execBd` calls.
- Never embed raw CLI stderr in a thrown error; run it through `sanitizeError()`.

## Testing

See [TESTING.md](TESTING.md) for the full picture. The one thing that trips people up:
the suite uses Mocha's **tdd** interface — `suite()` / `test()` with node `assert`. Not
`describe()` / `it()`. Assertion-library choice is distinct from the TDD interface;
existing suites also use Sinon where mocking is needed.

## Working on issues

This repo tracks its own backlog with `bd`, prefix `bbk-`. [AGENTS.md](AGENTS.md)
covers shared policy. Nested worktrees may resolve the main database; external
worktrees may not. Always target the verified main checkout explicitly, and
**never run `bd init` in a worktree**. The [OpenCode workflow](docs/development/opencode-workflow.md)
describes its role split, approval gates and capability limits; Claude imports
shared policy through its adapter without claiming OpenCode runtime parity.

External contributors do not need `bd` for issue tracking — use GitHub Issues.

## Reporting Bugs and Suggesting Features

Use the templates at
[balajidutt/better-beads-kanban/issues](https://github.com/balajidutt/better-beads-kanban/issues).

For bugs, include VS Code version, extension version, OS, `bd --version`, steps to
reproduce, and anything from the Output panel or the webview Developer Tools console.

## Debugging

1. `F5` launches the Extension Development Host
2. **Help > Toggle Developer Tools** for the webview console
3. Extension host logs go to the Output panel
4. `npm run test:visual-server` renders the webview in regular Chrome with mock data,
   which is the only way to use Chrome DevTools tooling against this UI — it cannot
   attach to VS Code's Electron webview host

## License

By contributing, you agree that your contributions will be licensed under the MIT License.
