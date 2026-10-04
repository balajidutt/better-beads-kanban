import test from 'node:test';
// A zone east of UTC, so local midnight falls on the previous UTC day and the local-day branch runs.
process.env.TZ = 'Asia/Singapore';

import assert from 'node:assert/strict';
import dates from '../../scripts/lib/bd-dates.js';

const { sameCalendarDay } = dates;

test('a date-only input matches bd 1.2.2 UTC midnight and bd 1.3 local midnight', () => {
  assert.ok(sameCalendarDay('2026-02-15', '2026-02-15T00:00:00Z'));
  const localMidnight = new Date(2026, 1, 15).toISOString();
  assert.ok(sameCalendarDay('2026-02-15', localMidnight));
  assert.ok(sameCalendarDay('2026-02-15T09:30:00Z', '2026-02-15T00:00:00Z'));
});

test('a different calendar day, a missing value or garbage does not match', () => {
  const nextLocalDay = new Date(2026, 1, 17, 12).toISOString();
  assert.ok(!sameCalendarDay('2026-02-15', nextLocalDay));
  assert.ok(!sameCalendarDay('2026-02-15', null));
  assert.ok(!sameCalendarDay('2026-02-15', 'soon'));
  assert.ok(!sameCalendarDay(null, '2026-02-15T00:00:00Z'));
});
