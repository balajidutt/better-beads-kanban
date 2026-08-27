# Security Policy

## Supported versions

This is a single-maintainer fork of [davidcforbes/Beads-Kanban](https://github.com/davidcforbes/Beads-Kanban), distributed as a VSIX from [GitHub Releases](https://github.com/balajidutt/better-beads-kanban/releases). Only the most recent release gets fixes. There are no maintenance branches, and older VSIXs are never patched in place — the fix ships in the next release and you reinstall.

## Reporting a vulnerability

Report privately through [GitHub Security Advisories](https://github.com/balajidutt/better-beads-kanban/security/advisories/new). Please do not open a public issue for anything exploitable.

No response-time commitment is offered. This is a spare-time project, so a realistic expectation is days to weeks, not hours. You will get an acknowledgement either way — including if the report is declined, with the reason.

## Scope

The extension does not open the issue database. Every read and every mutation shells out to the `bd` CLI, which owns the storage layer. So:

- **In scope:** the extension host (`src/`), the webview and its sanitization, how arguments are passed to `bd`, and what the VSIX ships.
- **Out of scope:** `bd` itself and its Dolt backend. Report those upstream at [gastownhall/beads](https://github.com/gastownhall/beads).

The webview runs with `unsafe-inline` styles under a nonce-based CSP. That is a known, accepted trade-off rather than an oversight; a report needs to show a concrete exploit path, not just the directive.
