#!/usr/bin/env node
/**
 * Bumps the extension version in lockstep across the places that must stay in
 * sync, and refuses to proceed if CHANGELOG.md isn't ready:
 *
 *   1. package.json "version"
 *   2. package-lock.json root "version" and packages[""].version
 *   3. src/webview.ts  const version = "..."  (cache-busting query string)
 *   4. CHANGELOG.md must already contain a `## [X.Y.Z]` heading
 *
 * VS Code marketplace requires major.minor.patch with no semver pre-release
 * tags (per https://code.visualstudio.com/api/working-with-extensions/publishing-extension),
 * so we enforce that strictly here.
 *
 * Usage: npm run release:bump -- X.Y.Z
 */
'use strict';

const fs = require('fs');
const path = require('path');

const PROJECT_ROOT = path.resolve(__dirname, '..');
// Upstream marketplace releases are strict major.minor.patch. This fork also ships
// private VSIX builds versioned X.Y.Z-bd.N, which are installed from a GitHub
// release rather than the marketplace, so the suffix is allowed here and nowhere
// else. Any other pre-release tag is still rejected.
const SEMVER_RE = /^\d+\.\d+\.\d+(-bd\.\d+)?$/;

function fail(msg) {
  process.stderr.write(`\nrelease:bump — ${msg}\n\n`);
  process.exit(1);
}

const newVersion = process.argv[2];
if (!newVersion) {
  fail('missing version argument. Usage: npm run release:bump -- X.Y.Z');
}
if (!SEMVER_RE.test(newVersion)) {
  fail(`"${newVersion}" is not major.minor.patch (or X.Y.Z-bd.N for fork VSIX builds) — VS Code marketplace rejects pre-release tags like 2.1.4-beta.1`);
}

// --- package.json -----------------------------------------------------------
const pkgPath = path.join(PROJECT_ROOT, 'package.json');
const pkgRaw = fs.readFileSync(pkgPath, 'utf8');
const pkgVersionMatch = pkgRaw.match(/"version"\s*:\s*"([^"]+)"/);
if (!pkgVersionMatch) {
  fail('could not find a "version" field in package.json');
}
const oldVersion = pkgVersionMatch[1];
if (oldVersion === newVersion) {
  fail(`package.json is already at ${newVersion} — nothing to do`);
}
const pkgUpdated = pkgRaw.replace(
  /("version"\s*:\s*")[^"]+(")/,
  `$1${newVersion}$2`
);

// --- package-lock.json ------------------------------------------------------
const lockPath = path.join(PROJECT_ROOT, 'package-lock.json');
if (!fs.existsSync(lockPath)) {
  fail('package-lock.json not found');
}
const lockRaw = fs.readFileSync(lockPath, 'utf8');
let lock;
try {
  lock = JSON.parse(lockRaw);
} catch {
  fail('package-lock.json is not valid JSON');
}
// npm keeps a lockfile's existing line endings, so CRLF checkouts stay CRLF.
const lockEol = lockRaw.includes('\r\n') ? '\r\n' : '\n';
const serializeLock = value => JSON.stringify(value, null, 2).replace(/\n/g, lockEol) + lockEol;
// Re-serializing must not touch any line but the two root versions.
if (serializeLock(lock) !== lockRaw) {
  fail('package-lock.json is not in npm\'s layout (2-space indent, one line-ending style, trailing newline); restore it from git and retry');
}
if (typeof lock.version !== 'string' || typeof lock.packages?.['']?.version !== 'string') {
  fail('could not find the root "version" and packages[""].version in package-lock.json');
}
lock.version = newVersion;
lock.packages[''].version = newVersion;
const lockUpdated = serializeLock(lock);

// --- src/webview.ts ---------------------------------------------------------
const webviewPath = path.join(PROJECT_ROOT, 'src', 'webview.ts');
const webviewRaw = fs.readFileSync(webviewPath, 'utf8');
const webviewVersionRe = /(const\s+version\s*=\s*")[^"]+(")/;
if (!webviewVersionRe.test(webviewRaw)) {
  fail('could not find `const version = "..."` in src/webview.ts');
}
const webviewUpdated = webviewRaw.replace(webviewVersionRe, `$1${newVersion}$2`);

// --- CHANGELOG.md (validate only; humans write the entry) -------------------
const changelogPath = path.join(PROJECT_ROOT, 'CHANGELOG.md');
const changelogRaw = fs.readFileSync(changelogPath, 'utf8');
const headingRe = new RegExp(
  `^##\\s*\\[${newVersion.replace(/\./g, '\\.')}\\]`,
  'm'
);
if (!headingRe.test(changelogRaw)) {
  fail(
    `CHANGELOG.md is missing a "## [${newVersion}]" heading.\n` +
    `Add an entry for ${newVersion} at the top of CHANGELOG.md before bumping ` +
    `(it documents what changed and is required by Keep-a-Changelog).`
  );
}

// --- Write every change only after every check passes ----------------------
fs.writeFileSync(pkgPath, pkgUpdated);
fs.writeFileSync(lockPath, lockUpdated);
fs.writeFileSync(webviewPath, webviewUpdated);

process.stdout.write(
  `\nrelease:bump — ${oldVersion} → ${newVersion}\n` +
  `  ✓ package.json\n` +
  `  ✓ package-lock.json\n` +
  `  ✓ src/webview.ts\n` +
  `  ✓ CHANGELOG.md heading present\n\n` +
  `Next:  bash scripts/release-fork-vsix.sh --release-issue <release-id> --dry-run\n\n`
);
