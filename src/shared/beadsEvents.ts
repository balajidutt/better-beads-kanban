/** One record from `bd events tail --json` (bd 1.3+), reduced to what the board needs. */
export interface BeadsEvent {
  seq: number;
  op: string;
  issueId: string;
}

/** The checkpoint fell below the retained window; `head` is the highest seq bd has assigned. */
export interface EventsTruncation {
  floor: number;
  head: number;
}

export type EventsLine =
  | { kind: 'event'; event: BeadsEvent }
  | { kind: 'truncated'; truncation: EventsTruncation }
  | { kind: 'other' };

const isCount = (value: unknown): value is number => typeof value === 'number' && Number.isSafeInteger(value) && value >= 0;

export function parseEventsLine(line: string): EventsLine {
  let record: unknown;
  try {
    record = JSON.parse(line);
  } catch {
    return { kind: 'other' };
  }
  if (!record || typeof record !== 'object' || Array.isArray(record)) { return { kind: 'other' }; }
  const value = record as Record<string, unknown>;
  if (value.code === 'events_journal_truncated' && isCount(value.floor) && isCount(value.head)) {
    return { kind: 'truncated', truncation: { floor: value.floor, head: value.head } };
  }
  if (isCount(value.seq) && typeof value.op === 'string' && typeof value.issue_id === 'string') {
    return { kind: 'event', event: { seq: value.seq, op: value.op, issueId: value.issue_id } };
  }
  return { kind: 'other' };
}

/**
 * bd 1.3.1 does not journal heartbeats. If a later bd does, a lease extension
 * alone is not worth reloading the whole board for.
 */
export function shouldRefreshForEvent(event: BeadsEvent): boolean {
  return event.op !== 'heartbeat';
}

/** The journal is clone-local, so a checkpoint only means something for one root and one database. */
export function eventsCheckpointKey(root: string, projectId: string): string {
  return `beadsKanban.eventsCheckpoint:${projectId}:${root}`;
}
