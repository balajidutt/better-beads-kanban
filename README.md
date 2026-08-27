# Better Beads Kanban

An independent, actively maintained fork of [Beads Kanban](https://github.com/davidcforbes/Beads-Kanban) for VS Code, updated for bd 1.x and Dolt-backed repositories.

View, create, edit, and organize the [Beads](https://github.com/gastownhall/beads) issues in your repository from four views — Kanban, table, tree, and dependency graph — without leaving the editor.

![Version](https://img.shields.io/badge/version-2.2.0-blue)
![License](https://img.shields.io/badge/license-MIT-green)
![VS Code](https://img.shields.io/badge/VS%20Code-1.90+-blue)

## Why this fork

Upstream has been dormant since April 2026. This fork continues it, and the differences are not cosmetic — on a bd 1.x repository, several things simply did not work.

| | Upstream 2.1.4 | Better Beads Kanban |
|---|---|---|
| bd 1.x / Dolt repositories | Watcher globs `*.db`/`*.sqlite`, so the board never auto-refreshes | Watches bd's write signals and the Dolt journal |
| Filters | Exclusive semantics — unchecking a value still showed it; closed issues shown by default | Inclusive multi-select with an `Active` default, matching `bd list` |
| Tree view | — | Parent/child hierarchy mirroring `bd list`, connector guides, per-level sibling sort |
| Rendering | Markdown preview pane never appeared; table issue IDs truncated to their last 8 characters | Preview works; full IDs |
| UI state | Sort, filters, and view choice reset on every panel close | Persist across close/reopen |
| Multi-root workspaces | Uses the first folder unconditionally | Picker choice → every root → upward walk |
| Missing `bd` on PATH | Reported as "Database file not found" | Names `bd`, PATH, and `beadsKanban.bdPath` |

The detail behind the rows that are hardest to take on trust:

**bd 1.x and Dolt support.** bd 1.x replaced SQLite with Dolt. The file watcher globbed `.beads/**/*.{db,sqlite,sqlite3}`, so on a Dolt-backed repository it had never once fired and the board never auto-refreshed. It now watches bd's write signals at the top of `.beads` and the Dolt journal under `<database>/.dolt/noms/`, filtering out the server log, lock, and pid files that churn on their own.

**Workspace discovery.** The board used `workspaceFolders[0]` unconditionally. A multi-root workspace worked only if the folder holding `.beads` happened to be listed first, and opening a subfolder of the repository did not work at all. Resolution now prefers the folder chosen in the repository picker, then checks every workspace root, then walks upward — and that choice survives a reload, where before it was written to workspace state under a key nothing read.

**A missing `bd` reported itself as a missing database.** `spawn bd ENOENT` was matched by a generic `ENOENT` branch, so a PATH problem surfaced as "Database file not found" and sent debugging into the folder picker. Spawn failures are classified first now, and the message names `bd`, PATH, and `beadsKanban.bdPath`.

Kanban cards also carry child / blocks / blocked-by affordances, derived per issue from its own dependency arrays.

See [CHANGELOG.md](CHANGELOG.md) for the full history.

## Screenshots

### Kanban View

Drag-and-drop cards between columns to manage your workflow.

![Kanban View](images/screenshots/kanban-view.jpg)

### Table View

Sort, filter, and customize columns for detailed issue management.

![Table View](images/screenshots/table-view.jpg)

### Tree View

Browse the parent/child hierarchy like `bd list`, with expandable nodes and connector guides.

![Tree View](images/screenshots/tree-view.jpg)

### Dependency Graph View

Visualize issue relationships and dependencies with an interactive graph.

![Graph View](images/screenshots/graph-view.jpg)

### Edit Issue Form

Issue editing with all metadata fields, dependencies, and comments.

![Edit Form](images/screenshots/edit-form.jpg)

## Features

**Visual Kanban Board**

- Drag-and-drop cards between columns (Ready, In Progress, Blocked, Closed)
- Auto-refresh when the underlying database changes
- Incremental loading for large issue databases (10,000+ issues)

**Table View**

- Sortable columns with multi-column sorting (Shift+Click)
- Customizable column visibility
- Pagination with configurable page sizes
- Filter by priority, type, status, and search

**Tree View**

- Expandable parent/child hierarchy, mirroring `bd list`'s tree output
- Connector guide lines show sibling and nesting structure at a glance
- bd-style rows: colored status glyph, click-to-copy issue id, priority and type, then the title
- Filters and search show matching issues with their full ancestor chain (non-matching ancestors are dimmed as context)
- Sibling sort by Updated, Priority, Title, or Created at every level
- Expansion, sort, and view choice persist across panel close/reopen

**Dependency Graph**

- Interactive visualization of issue relationships
- Hierarchical layout with parent-child and blocking dependencies
- Focus mode to explore specific issues and their dependencies
- Drag nodes, zoom/pan controls
- Color-coded by status with visual legend

**Full Issue Management**

- Create, edit, and update issues
- Add comments, labels, and dependencies
- Markdown support with live preview
- Rich metadata fields (priority, assignee, estimated time, etc.)

**Daemon Integration**

- Uses the `bd` CLI daemon for all database operations
- Auto-starts the daemon when the extension loads
- Efficient incremental data loading

## Installation

This fork is **not** published to the VS Code Marketplace. Install the VSIX from this repository's releases:

1. Download the latest `.vsix` from [Releases](https://github.com/balajidutt/better-beads-kanban/releases)
2. In VS Code: `Extensions > ... > Install from VSIX...`
3. Select the downloaded file
4. Reload VS Code

Each release also publishes a `SHA256SUMS` file if you want to verify the download.

> Searching the Marketplace for "Beads Kanban" finds upstream's extension, which does not carry any of the changes above.

### Upgrading from `beads-kanban-bd-fixes`

Releases before 2.2.0 used the extension ID `balaji-dutt.beads-kanban-bd-fixes`. From 2.2.0 it is `balaji-dutt.better-beads-kanban`. VS Code treats that as a different extension, so uninstall the old one first — otherwise both register the "Beads: Open Kanban Board" command:

```bash
code --uninstall-extension balaji-dutt.beads-kanban-bd-fixes
```

## Prerequisites

- **Beads CLI** (`bd`): required for all database operations. Install from [github.com/gastownhall/beads](https://github.com/gastownhall/beads).
- The extension auto-starts the `bd` daemon when needed.

## Quick Start

1. **Initialize Beads in your project** (if not already done):

   ```bash
   bd init
   ```

2. **Open the Kanban board**: Command Palette (`Ctrl+Shift+P`) → "Beads: Open Kanban Board"

3. **Start managing issues**:
   - Create issues with the "New" button
   - Drag cards between columns to update status
   - Click cards to view/edit details
   - Switch views with the Kanban / Table / Tree / Graph toggle

## What is Beads?

Beads is an AI-native issue tracking system that lives directly in your codebase, keeping issues close to code and usable by coding agents.

As of bd 1.x, issues are stored in a [Dolt](https://www.dolthub.com/) database under `.beads/` (JSONL is also supported); earlier versions used SQLite. This extension never opens that database itself — every read and write goes through the `bd` CLI, so it stays correct across storage backends.

**Learn more:** [github.com/gastownhall/beads](https://github.com/gastownhall/beads)

## Configuration

| Setting | Default | Description |
| --------- | --------- | ------------- |
| `beadsKanban.bdPath` | `""` | Absolute path to the `bd` CLI. Leave empty to use system PATH. |
| `beadsKanban.readOnly` | `false` | Enable read-only mode (no edits) |
| `beadsKanban.initialLoadLimit` | `100` | Issues per column on initial load |
| `beadsKanban.pageSize` | `50` | Issues to load when clicking "Load More" |
| `beadsKanban.preloadClosedColumn` | `false` | Load closed issues on initial load |
| `beadsKanban.lazyLoadDependencies` | `true` | Load dependencies on-demand |
| `beadsKanban.issuePrefix` | `""` | Issue ID prefix. Leave empty to auto-detect. |

## Development

### Prerequisites

- Node.js 20+
- VS Code 1.90+

### Build from Source

```bash
git clone https://github.com/balajidutt/better-beads-kanban.git
cd better-beads-kanban

npm install
npm run compile
npm test

npx @vscode/vsce package
```

### Development Workflow

1. Press `F5` to launch the Extension Development Host
2. Make changes to source files
3. Press `Ctrl+Shift+F5` to reload the extension
4. Use `npm run watch` for automatic compilation

## Testing

```bash
# Run all tests
npm test

# Watch mode
npm run test:watch

# Coverage report
npm run test:coverage

# Integration tests
npm run test:adapter
```

## Architecture

- **Extension Host** (`src/extension.ts`): command registration, webview lifecycle, message routing
- **Data Adapter** (`src/daemonBeadsAdapter.ts`): CLI-based daemon adapter for all database operations
- **Webview UI** (`src/webview/board.js`, `src/webview/treeBuilder.ts`, `media/styles.css`): reactive UI with incremental loading

See [CLAUDE.md](CLAUDE.md) for detailed architecture documentation.

## Visual Testing

A standalone visual test server renders the webview in regular Chrome for automated UI testing:

```bash
# Launch the test server (opens Chrome with the board rendered using mock data)
npm run test:visual-server

# Light theme variant
npm run test:visual-server -- --theme=light

# Server only (no Chrome auto-launch)
npm run test:visual-server -- --no-chrome
```

It serves the same webview HTML/CSS/JS as the extension, with a mock VS Code API that responds to all message types. This exists because Chrome DevTools tooling cannot attach to VS Code's Electron webview host.

See `scripts/seed-test-data.sh` for creating representative test data in a real `.beads` database.

## Contributing

Issues and pull requests are welcome at [balajidutt/better-beads-kanban](https://github.com/balajidutt/better-beads-kanban).

See [CONTRIBUTING.md](CONTRIBUTING.md) for setup, branch and commit conventions, the test layout, and what a reviewable pull request looks like. [TESTING.md](TESTING.md) covers running the suite and the manual QA pass before a release.

The short version:

1. Fork the repository
2. Create a feature branch (`git checkout -b feature/amazing-feature`)
3. Commit your changes, following existing code style (`npm run lint`)
4. Push and open a pull request

## Attribution

This is a fork of a fork. The lineage, oldest first:

1. [sebcook-ctrl/agent.native.activity.layer.beads](https://github.com/sebcook-ctrl/agent.native.activity.layer.beads) — the original work.
2. [davidcforbes/Beads-Kanban](https://github.com/davidcforbes/Beads-Kanban) — forked from the above and carried it through version 2.1.4, adding the table and graph views. Dormant since April 2026.
3. This repository — forked from davidcforbes, and the maintained line from 2.2.0 onward.

The `upstream` remote still points at davidcforbes so changes there can be picked up if it revives.

## License

MIT License — see [LICENSE](LICENSE).

Copyright (c) 2024 Agent Native Kanban Contributors
Original work Copyright (c) 2024 sebcook-ctrl
