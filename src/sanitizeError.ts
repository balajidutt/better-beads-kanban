import {
  findBdCommandError, isClaimHeldByOther, isClosePolicyRefusal, isEventsJournalTruncated, isEventsTableMissing,
  isGuardMismatch, isMaxRowsExceeded, isPendingMigration, sanitizeError
} from './shared/node';
export { sanitizeError } from './shared/node';

// Node reports a failed `spawn` as "spawn <command> ENOENT" (or EACCES/EPERM),
// never with the shell phrasing "bd: command not found". The command is matched
// non-greedily rather than as \S+ because a Windows bd path can contain spaces,
// e.g. "spawn C:\Program Files\bd\bd.exe ENOENT".
export const SPAWN_ENOENT_RE = /\bspawn\s+.+?\s+ENOENT\b/;
export const SPAWN_EACCES_RE = /\bspawn\s+.+?\s+(?:EACCES|EPERM)\b/;

/**
 * True when the error means the bd executable could not be found.
 *
 * Match against the RAW message, before sanitizeError() runs: an absolute
 * `beadsKanban.bdPath` is rewritten to "[PATH]" by sanitizeError's path scrubbers,
 * so matching the binary name is not reliable. The legacy shell phrasings are
 * kept so a message routed in from a shell wrapper still resolves correctly.
 */
export function isBdMissingError(raw: string): boolean {
  return SPAWN_ENOENT_RE.test(raw)
    || raw.includes('bd command not found')
    || raw.includes('bd: command not found');
}

/**
 * True when the bd executable was found but could not be run.
 */
export function isBdNotExecutableError(raw: string): boolean {
  return SPAWN_EACCES_RE.test(raw);
}

/**
 * Sanitizes error messages with user-friendly messages for common cases.
 * Use this in the extension where providing helpful context is important.
 * Provides actionable guidance to help users resolve issues.
 */
export function sanitizeErrorWithContext(error: unknown): string {
  const raw = error instanceof Error ? error.message : String(error);
  const sanitized = sanitizeError(error);

  // Provide specific, actionable error messages for common cases

  // Spawn failures must be classified before the generic ENOENT branch below,
  // which would otherwise report a missing binary as a missing database.
  if (isBdMissingError(raw)) {
    return 'Beads CLI (bd) not found. Install beads and add it to your PATH, or set "beadsKanban.bdPath" to the absolute path of the bd executable.';
  }
  if (isBdNotExecutableError(raw)) {
    return 'Beads CLI (bd) was found but could not be run. Check that it is executable, or set "beadsKanban.bdPath" to a working bd executable.';
  }

  // bd 1.3 refusals, classified on the exit code and raw output carried by BdCommandError.
  if (isGuardMismatch(error)) {
    return 'This issue was changed elsewhere since the board loaded, so the change was not applied. Refresh the board and try again if it still applies.';
  }
  if (isClosePolicyRefusal(error)) {
    return `Close refused: ${closeRefusalReason(error)}.`;
  }
  if (isClaimHeldByOther(error)) {
    return 'Someone else holds the claim on this issue, so it was not changed. Refresh the board to see who.';
  }
  if (isMaxRowsExceeded(error)) {
    return 'bd refused the query because BEADS_MAX_ROWS is lower than the number of matching issues. Raise or unset BEADS_MAX_ROWS in the environment VS Code starts from.';
  }
  if (isPendingMigration(error)) {
    return 'This Beads database has schema migrations waiting to be applied. Run "bd migrate schema" in a terminal in this workspace; on a shared server, coordinate with its other clients first.';
  }
  if (isEventsTableMissing(error)) {
    return 'This Beads database is missing its events table (bd 1.3.0 issue #6142), so writes fail. Upgrade bd to 1.3.1 or later.';
  }
  if (isEventsJournalTruncated(error)) {
    return 'The events journal was pruned past the last change the board saw. Refresh the board.';
  }

  // File system errors
  if (sanitized.includes('ENOENT')) {
    return 'Database file not found. Click the Refresh button or check that the .beads directory exists in your workspace.';
  }
  if (sanitized.includes('EACCES') || sanitized.includes('EPERM')) {
    return 'Permission denied accessing database file. Check file permissions in the .beads directory.';
  }

  // Database errors
  if (sanitized.includes('SQLITE_BUSY')) {
    return 'Database is locked by another process. Close other applications accessing the database and try again.';
  }
  if (sanitized.includes('SQLITE_CORRUPT')) {
    return 'Database file is corrupted. You may need to restore from backup or reinitialize with "bd init".';
  }
  if (sanitized.includes('SQLITE_CANTOPEN')) {
    return 'Cannot open database file. Ensure the .beads directory exists and has proper permissions.';
  }
  if (sanitized.includes('not connected') || sanitized.includes('Database not connected')) {
    return 'Database connection lost. Click the Refresh button to reconnect.';
  }

  // Network/timeout errors
  if (sanitized.includes('timeout') || sanitized.includes('timed out') || sanitized.includes('ETIMEDOUT')) {
    return 'Operation timed out. The request is taking longer than expected. Try again.';
  }
  if (sanitized.includes('ECONNREFUSED') || sanitized.includes('connection refused')) {
    return 'Connection refused. If this workspace uses a Dolt server, check that it is running.';
  }

  // Validation errors (keep as-is, they're already user-friendly)
  if (sanitized.includes('Invalid') || sanitized.includes('validation') || sanitized.includes('required')) {
    return sanitized;
  }

  // Parsing errors
  if (sanitized.includes('JSON') || sanitized.includes('parse')) {
    return 'Invalid data format received. This may indicate a version mismatch. Try refreshing the board.';
  }

  // Return generic message only if truly empty or unrecognizable
  if (sanitized.length === 0) {
    return 'An unexpected error occurred. Check the Output panel (View > Output > Beads Kanban) for details.';
  }

  // Return sanitized message with helpful suffix for unrecognized errors
  return `${sanitized}. If this persists, check the Output panel (View > Output > Beads Kanban) for details.`;
}

const MAX_CLOSE_REASON_LENGTH = 200;

/** The first `cannot close ...` clause from bd's refusal, without its CLI advice about --force. */
function closeRefusalReason(error: unknown): string {
  const bdError = findBdCommandError(error);
  const match = /cannot close [^;\n]*/.exec(bdError ? `${bdError.stderr}\n${bdError.stdout}` : '');
  if (!match) { return 'the issue has open child issues or an unresolved blocker'; }
  return sanitizeError(match[0]).slice(0, MAX_CLOSE_REASON_LENGTH);
}
