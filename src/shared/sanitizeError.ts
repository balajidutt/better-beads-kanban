export function sanitizeError(error: unknown): string {
  const msg = error instanceof Error ? error.message : String(error);
  const sanitized = msg
    .replace(/[A-Za-z]:[\\/][^\s]*/g, '[PATH]')
    .replace(/\\\\[^\s]+/g, '[PATH]')
    .replace(/\/(?:usr|home|opt|var|tmp|etc|lib|bin|sbin|mnt|srv|root|proc|sys|dev|Applications|Users|Library)(?:\/[^\s]*)?/g, '[PATH]')
    .replace(/(?:\/|\\)[^\s]*\.(ts|js|tsx|jsx|db|sqlite|sqlite3|json|log|txt)/g, '[FILE]')
    .replace(/\s+at\s+.*/g, '');
  return sanitized.trim() || 'An error occurred while processing your request.';
}
