import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { eventsCheckpointKey, parseEventsLine, shouldRefreshForEvent } from '../../shared/node';
import { RecordedFailure, SeededIds, loadFixture } from './bdFixtures';

function fixtureText(name: string): string {
  let dir = __dirname;
  while (!fs.existsSync(path.join(dir, 'src', 'test', 'fixtures', 'bd-1.3.1'))) { dir = path.dirname(dir); }
  return fs.readFileSync(path.join(dir, 'src', 'test', 'fixtures', 'bd-1.3.1', name), 'utf8');
}

suite('Events journal lines', () => {
  test('recorded tail lines parse into seq, op and issue id', () => {
    const ids = loadFixture<SeededIds>('1.3.1', 'ids.json');
    const parsed = fixtureText('events-tail.jsonl').split('\n').filter(Boolean).map(parseEventsLine);
    assert.deepStrictEqual(parsed, [
      { kind: 'event', event: { seq: 1, op: 'update', issueId: ids.blocker } },
      { kind: 'event', event: { seq: 2, op: 'comment', issueId: ids.blocker } }
    ]);
  });

  test('the recorded truncation body parses into floor and head', () => {
    const recorded = loadFixture<RecordedFailure>('1.3.1', 'events-tail-truncated.json');
    assert.deepStrictEqual(parseEventsLine(JSON.stringify(recorded.stdout)), { kind: 'truncated', truncation: { floor: 2, head: 2 } });
  });

  test('anything else is ignored rather than trusted', () => {
    for (const line of ['', 'not json', '[]', 'null', '{"seq":"1","op":"update","issue_id":"x"}', '{"seq":-1,"op":"update","issue_id":"x"}',
      '{"seq":1,"op":"update"}', '{"code":"events_journal_truncated","floor":"2","head":2}', 'note: the events journal is disabled']) {
      assert.deepStrictEqual(parseEventsLine(line), { kind: 'other' }, line);
    }
  });

  test('heartbeats do not refresh the board; every other op does', () => {
    assert.strictEqual(shouldRefreshForEvent({ seq: 1, op: 'heartbeat', issueId: 'x-1' }), false);
    for (const op of ['create', 'update', 'close', 'delete', 'dep_add', 'dep_remove', 'comment']) {
      assert.strictEqual(shouldRefreshForEvent({ seq: 1, op, issueId: 'x-1' }), true, op);
    }
  });

  test('checkpoints are keyed by database and root', () => {
    assert.notStrictEqual(eventsCheckpointKey('/a', 'p1'), eventsCheckpointKey('/a', 'p2'));
    assert.notStrictEqual(eventsCheckpointKey('/a', 'p1'), eventsCheckpointKey('/b', 'p1'));
  });
});
