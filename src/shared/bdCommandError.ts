/**
 * A bd process that exited non-zero. The message is the sanitized text callers
 * match on; exit code and raw streams are for classification and logs only and
 * must never be sent to the webview.
 */
export class BdCommandError extends Error {
  readonly exitCode: number | null;
  readonly stderr: string;
  readonly stdout: string;
  readonly args: readonly string[];

  constructor(message: string, details: { exitCode: number | null; stderr: string; stdout: string; args: readonly string[] }) {
    super(message);
    this.name = 'BdCommandError';
    this.exitCode = details.exitCode;
    this.stderr = details.stderr;
    this.stdout = details.stdout;
    this.args = details.args;
  }
}

export function findBdCommandError(error: unknown): BdCommandError | undefined {
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current && !seen.has(current)) {
    if (current instanceof BdCommandError) { return current; }
    seen.add(current);
    current = (current as { cause?: unknown }).cause;
  }
  return undefined;
}

function output(error: BdCommandError): string {
  return `${error.stderr}\n${error.stdout}`;
}

/** bd 1.3+: an --if-status / --if-assignee precondition no longer held; nothing was written. */
export function isGuardMismatch(error: unknown): boolean {
  return findBdCommandError(error)?.exitCode === 13;
}

const CLOSE_POLICY_REASON = /cannot close [^:\s]+: \d+ open child issue|cannot close blocked issue/;

/** bd 1.3+: moving to closed was refused because of open children or a live blocker. */
export function isClosePolicyRefusal(error: unknown): boolean {
  const bdError = findBdCommandError(error);
  return !!bdError && bdError.exitCode === 1 && CLOSE_POLICY_REASON.test(output(bdError));
}

/** bd 1.3: a claim, heartbeat or release was refused because another actor holds the claim. */
export function isClaimHeldByOther(error: unknown): boolean {
  const bdError = findBdCommandError(error);
  return !!bdError && /issue already claimed by |claimed by a different actor/.test(output(bdError));
}

/** BEADS_MAX_ROWS (or --max-rows) capped a query below the number of matching rows. */
export function isMaxRowsExceeded(error: unknown): boolean {
  const bdError = findBdCommandError(error);
  return !!bdError && bdError.exitCode === 2 && /too many rows/.test(output(bdError));
}

/** A shared-server or remote-backed store refuses to open until its schema migrations are applied. */
export function isPendingMigration(error: unknown): boolean {
  const bdError = findBdCommandError(error);
  return !!bdError && /(?<!applying )(?<!\d)\d+ pending schema migration\(s\)/.test(output(bdError));
}

/** The events-journal checkpoint fell below the retained window. */
export function isEventsJournalTruncated(error: unknown): boolean {
  const bdError = findBdCommandError(error);
  return !!bdError && /events_journal_truncated|events journal truncated/.test(output(bdError));
}

/** bd 1.3.0 issue #6142: a store without an `events` table cannot be written to; fixed in 1.3.1. */
export function isEventsTableMissing(error: unknown): boolean {
  const bdError = findBdCommandError(error);
  return !!bdError && /table not found: events\b/.test(output(bdError));
}
