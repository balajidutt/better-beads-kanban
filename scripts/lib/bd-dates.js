'use strict';

/**
 * True when `actual`, a timestamp bd returned, is on the calendar day of
 * `expected` (YYYY-MM-DD or an ISO timestamp whose date part is used), read
 * either in UTC or in local time.
 *
 * bd stores a date-only --due/--defer as a full timestamp: bd 1.2.2 uses
 * midnight UTC, whose UTC date matches; bd 1.3 uses local midnight converted
 * to UTC, whose local date matches.
 */
function sameCalendarDay(expected, actual) {
  if (typeof expected !== 'string' || typeof actual !== 'string') { return false; }
  const day = expected.split('T')[0];
  if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) { return false; }
  if (actual.startsWith(day)) { return true; }
  const parsed = new Date(actual);
  if (Number.isNaN(parsed.getTime())) { return false; }
  const pad = n => String(n).padStart(2, '0');
  const localDay = `${parsed.getFullYear()}-${pad(parsed.getMonth() + 1)}-${pad(parsed.getDate())}`;
  return localDay === day;
}

module.exports = { sameCalendarDay };
