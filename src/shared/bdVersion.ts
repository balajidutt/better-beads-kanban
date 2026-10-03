export const MIN_SUPPORTED_BD_VERSION = '1.2.2';
export const FULL_SUPPORT_BD_VERSION = '1.3.0';

export interface BdVersion {
  major: number;
  minor: number;
  patch: number;
  prerelease: string | null;
  raw: string;
}

/** Feature flags that only bd 1.3.0 and later accept. Callers must check a flag before passing it. */
export interface BdCapabilities {
  version: string | null;
  closePolicy: boolean;
  ifStatus: boolean;
  briefDeps: boolean;
  leases: boolean;
  eventsJournal: boolean;
}

const VERSION_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+[0-9A-Za-z.-]+)?$/;

/** Accepts a version string or the object `bd version --json` prints. */
export function parseBdVersion(value: unknown): BdVersion | undefined {
  const text = typeof value === 'string'
    ? value
    : (value && typeof value === 'object' && typeof (value as { version?: unknown }).version === 'string')
      ? (value as { version: string }).version
      : undefined;
  const match = text ? VERSION_PATTERN.exec(text.trim()) : null;
  if (!match) { return undefined; }
  return {
    major: Number(match[1]), minor: Number(match[2]), patch: Number(match[3]),
    prerelease: match[4] ?? null, raw: text!.trim()
  };
}

/** SemVer precedence: negative when a < b, and a prerelease sorts before its release. */
export function compareBdVersions(a: BdVersion, b: BdVersion): number {
  const core = (a.major - b.major) || (a.minor - b.minor) || (a.patch - b.patch);
  if (core !== 0) { return Math.sign(core); }
  if (a.prerelease === b.prerelease) { return 0; }
  if (a.prerelease === null) { return 1; }
  if (b.prerelease === null) { return -1; }
  return comparePrerelease(a.prerelease.split('.'), b.prerelease.split('.'));
}

function comparePrerelease(a: string[], b: string[]): number {
  for (let i = 0; i < Math.min(a.length, b.length); i++) {
    const aNumeric = /^\d+$/.test(a[i]);
    const bNumeric = /^\d+$/.test(b[i]);
    if (aNumeric && bNumeric) {
      const diff = Number(a[i]) - Number(b[i]);
      if (diff !== 0) { return Math.sign(diff); }
    } else if (aNumeric !== bNumeric) {
      return aNumeric ? -1 : 1;
    } else if (a[i] !== b[i]) {
      return a[i] < b[i] ? -1 : 1;
    }
  }
  return Math.sign(a.length - b.length);
}

function atLeast(version: BdVersion | undefined, floor: string): boolean {
  const parsedFloor = parseBdVersion(floor) as BdVersion;
  return !!version && compareBdVersions(version, parsedFloor) >= 0;
}

/** An unknown or unparseable version gets the 1.2.2 feature set, so no 1.3-only flag is ever sent to it. */
export function capabilitiesFor(version: BdVersion | undefined): BdCapabilities {
  const full = atLeast(version, FULL_SUPPORT_BD_VERSION);
  return {
    version: version?.raw ?? null,
    closePolicy: full, ifStatus: full, briefDeps: full, leases: full, eventsJournal: full
  };
}

/** Only a version that parsed and sorts below the floor counts; an unknown version is not reported. */
export function isBelowMinimumBdVersion(version: BdVersion | undefined): boolean {
  return !!version && !atLeast(version, MIN_SUPPORTED_BD_VERSION);
}

/**
 * Whether the next store-opening command may run schema migrations, judged from
 * the `.beads/.local_version` bd writes on open. A missing or unreadable file
 * counts as a possible migration.
 */
export function mayMigrateOnOpen(binary: BdVersion | undefined, localVersionText: string | null): boolean {
  if (localVersionText === null) { return true; }
  const local = parseBdVersion(localVersionText);
  if (!binary || !local) { return true; }
  return compareBdVersions(binary, local) !== 0;
}
