# Contributing to Better Beads Kanban

Thanks for your interest. This is a single-maintainer fork, so PRs are welcome but
review is best-effort and may take a while. If you are planning something substantial,
open an issue first rather than building it and hoping.

## Getting Started

### Prerequisites

- Node.js 20 or higher (CI uses 22, per `.node-version`)
- VS Code 1.90 or higher
- Git
- [Beads CLI](https://github.com/gastownhall/beads) (`bd`) on `PATH`, or configured via
  the `beadsKanban.bdPath` setting

The extension shells out to `bd` for everything. Without it, the board cannot load and
most of the test suite skips.

### Fork, clone, install

```bash
git clone https://github.com/YOUR-USERNAME/better-beads-kanban.git
cd better-beads-kanban
git remote add upstream https://github.com/balajidutt/better-beads-kanban.git
npm install
```

### Build and run

```bash
npm run compile      # bundle extension host + webview, copy deps
npm run watch        # rebuild on change
```

Press `F5` in VS Code to launch the Extension Development Host, then run
**Beads: Open Kanban Board**.

`scripts/seed-test-data.sh` populates a `.beads` database with representative issues
to develop against.

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

### Before you open a PR

```bash
npm run verify       # tsc --noEmit, then eslint, then the extension suite
```

That is the same gate `scripts/release-fork-vsix.sh` runs before packaging. If it
passes locally it should pass in CI.

Checklist:

- [ ] `npm run verify` passes
- [ ] New behaviour has a test; bug fixes have a regression test
- [ ] Docs updated if you changed architecture (`CLAUDE.md`) or user-facing behaviour (`README.md`)
- [ ] Screenshots for UI changes
- [ ] Breaking changes called out explicitly

Do not add a `CHANGELOG.md` entry in your PR. Entries are written at release-cut time
from the release's scope — see [RELEASING.md](RELEASING.md).

## Coding Standards

### TypeScript

- Use `unknown` rather than `any` in production code, with explicit type assertions at
  the point of use. `CLAUDE.md` has the patterns this codebase settled on.
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

`CLAUDE.md` has a "Security Rules" section. These are not suggestions — each one is
there because it was violated and caused a bug. The short version:

- Every `innerHTML` assignment goes through `DOMPurify.sanitize()`, even for
  pre-escaped values.
- Every webview message handler validates its payload with a Zod schema before use.
- All flags go **before** the `--` separator in `execBd` calls.
- Never embed raw CLI stderr in a thrown error; run it through `sanitizeError()`.

## Testing

See [TESTING.md](TESTING.md) for the full picture. The one thing that trips people up:
the suite uses Mocha's **tdd** interface — `suite()` / `test()` with node `assert`. Not
`describe()` / `it()`, and not chai. A test written the other way silently never runs.

## Working on issues

This repo tracks its own backlog with `bd`, prefix `bbk-`. `AGENTS.md` covers the
workflow, including one trap worth stating here: **`bd` does not work from a git
worktree, and running `bd init` there creates a second, empty database that syncs
nowhere.** Run `bd` against the main checkout instead.

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
