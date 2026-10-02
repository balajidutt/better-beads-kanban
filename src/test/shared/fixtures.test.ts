import * as assert from 'assert';
import { mapBdListIssuesToEnrichedCards, mapBdShowIssueToFullCard } from '../../shared/issueMapping';
import { EnrichedCard } from '../../shared/issueTypes';
import { RECORDED_BD_VERSIONS, RecordedFailure, SeededIds, loadFixture, loadFixtureLines } from './bdFixtures';

for (const version of RECORDED_BD_VERSIONS) {
  suite(`Recorded bd ${version} output through the shared mappers`, () => {
    const ids = loadFixture<SeededIds>(version, 'ids.json');
    const listRaw = loadFixture<Record<string, unknown>[]>(version, 'list-all.json');
    const showRaw = loadFixture<Record<string, unknown>[]>(version, 'show-full.json');

    const byId = (cards: EnrichedCard[], id: string): EnrichedCard => {
      const card = cards.find(c => c.id === id);
      assert.ok(card, `card ${id} missing`);
      return card;
    };

    test('list maps every seeded issue with its stored status', () => {
      const cards = mapBdListIssuesToEnrichedCards(listRaw);
      assert.strictEqual(cards.length, Object.keys(ids).length);
      assert.strictEqual(byId(cards, ids.claimed).status, 'in_progress');
      assert.strictEqual(byId(cards, ids.deferred).status, 'deferred');
      assert.strictEqual(byId(cards, ids.blocked).status, 'open');
    });

    test('list relationships come from the dependency edges', () => {
      const cards = mapBdListIssuesToEnrichedCards(listRaw);
      assert.strictEqual(byId(cards, ids.child).parent?.id, ids.parent);
      assert.deepStrictEqual(byId(cards, ids.parent).children?.map(c => c.id), [ids.child]);
      assert.deepStrictEqual(byId(cards, ids.blocked).blocked_by?.map(c => c.id), [ids.blocker]);
      assert.deepStrictEqual(byId(cards, ids.blocker).blocks?.map(c => c.id), [ids.blocked]);
    });

    test('list maps the claimant as assignee and leaves unclaimed issues unassigned', () => {
      const cards = mapBdListIssuesToEnrichedCards(listRaw);
      assert.strictEqual(byId(cards, ids.claimed).assignee, 'fixture-actor');
      assert.strictEqual(byId(cards, ids.parent).assignee, null);
    });

    test('raw list output carries the creator as owner even when unassigned', () => {
      const rawUnassigned = listRaw.find(i => i.id === ids.parent);
      assert.strictEqual(rawUnassigned?.assignee, undefined);
      assert.strictEqual(rawUnassigned?.owner, 'fixture-owner@example.com');
    });

    test('list output carries no blocker count, so readiness cannot come from list alone', () => {
      for (const issue of listRaw) {
        assert.strictEqual(issue.blocked_by_count, undefined);
        assert.strictEqual(issue.is_blocked, undefined);
      }
    });

    test('ready excludes the blocked, claimed and deferred issues', () => {
      const ready = loadFixture<Record<string, unknown>[]>(version, 'ready.json').map(i => i.id).sort();
      assert.deepStrictEqual(ready, [ids.blocker, ids.child, ids.parent].sort());
    });

    test('show maps relationships from dependency_type edges', () => {
      const show = (id: string) => mapBdShowIssueToFullCard(showRaw.find(i => i.id === id) as Record<string, unknown>, id);
      assert.strictEqual(show(ids.child).parent?.id, ids.parent);
      assert.deepStrictEqual(show(ids.parent).children?.map(c => c.id), [ids.child]);
      assert.deepStrictEqual(show(ids.blocked).blocked_by?.map(c => c.id), [ids.blocker]);
      assert.deepStrictEqual(show(ids.blocker).blocks?.map(c => c.id), [ids.blocked]);
    });

    test('show returns comment bodies with string ids', () => {
      const card = mapBdShowIssueToFullCard(showRaw.find(i => i.id === ids.claimed) as Record<string, unknown>, ids.claimed);
      assert.strictEqual(card.comments?.length, 1);
      assert.strictEqual(card.comments?.[0].text, 'First comment');
      assert.strictEqual(typeof card.comments?.[0].id, 'string');
      assert.ok(String(card.comments?.[0].id).length > 0);
    });

    test('bd comments --json returns string ids', () => {
      const comments = loadFixture<Record<string, unknown>[]>(version, 'comments.json');
      assert.strictEqual(comments.length, 1);
      assert.strictEqual(typeof comments[0].id, 'string');
    });

    test('version --json reports the recorded version', () => {
      assert.strictEqual(loadFixture<{ version: string }>(version, 'version.json').version, version);
      assert.strictEqual(loadFixture<{ written: boolean; value: string }>(version, 'local-version.json').value, version);
    });
  });
}

suite('Recorded bd 1.3.1 behaviour that 1.2.2 lacks', () => {
  const ids = loadFixture<SeededIds>('1.3.1', 'ids.json');

  test('closing a parent with an open child is refused with exit 1', () => {
    const refusal = loadFixture<RecordedFailure>('1.3.1', 'close-refused-children.json');
    assert.strictEqual(refusal.exitCode, 1);
    assert.match(refusal.stderr, new RegExp(`cannot close ${ids.parent}: 1 open child issue`));
    assert.strictEqual(loadFixture<RecordedFailure>('1.2.2', 'close-refused-children.json').exitCode, 0);
  });

  test('closing an issue with a live blocker is refused with exit 1', () => {
    const refusal = loadFixture<RecordedFailure>('1.3.1', 'close-refused-blocker.json');
    assert.strictEqual(refusal.exitCode, 1);
    assert.match(refusal.stderr, /cannot close blocked issue/);
  });

  test('an --if-status mismatch exits 13 with guard_mismatch in the JSON on stderr', () => {
    const mismatch = loadFixture<RecordedFailure>('1.3.1', 'if-status-mismatch.json');
    assert.strictEqual(mismatch.exitCode, 13);
    assert.strictEqual(mismatch.stdout, '');
    const lastLine = mismatch.stderr.trim().split('\n').pop() as string;
    const failed = (JSON.parse(lastLine) as { failed: Array<{ guard_mismatch?: boolean }> }).failed;
    assert.strictEqual(failed[0].guard_mismatch, true);
    assert.match(loadFixture<RecordedFailure>('1.2.2', 'if-status-mismatch.json').stderr, /unknown flag: --if-status/);
  });

  test('the claimed issue carries lease fields in list output', () => {
    const claimed = loadFixture<Record<string, unknown>[]>('1.3.1', 'list-all.json').find(i => i.id === ids.claimed);
    assert.strictEqual(typeof claimed?.lease_expires_at, 'string');
    assert.strictEqual(typeof claimed?.heartbeat_at, 'string');
    assert.strictEqual(typeof claimed?.started_at, 'string');
  });

  test('another actor cannot unclaim without --force', () => {
    const refusal = loadFixture<RecordedFailure>('1.3.1', 'unclaim-not-holder.json');
    assert.notStrictEqual(refusal.exitCode, 0);
    assert.match(refusal.stderr, /claimed by a different actor/);
  });

  test('BEADS_MAX_ROWS overflow exits 2 with a too-many-rows message', () => {
    const overflow = loadFixture<RecordedFailure>('1.3.1', 'max-rows.json');
    assert.strictEqual(overflow.exitCode, 2);
    assert.match(overflow.stderr, /too many rows/);
  });

  test('events tail lines carry seq, op and the post-mutation issue', () => {
    const lines = loadFixtureLines('1.3.1', 'events-tail.jsonl');
    assert.deepStrictEqual(lines.map(l => l.op), ['update', 'comment']);
    assert.deepStrictEqual(lines.map(l => l.seq), [1, 2]);
    assert.strictEqual((lines[0].issue as { id: string }).id, ids.blocker);
  });

  test('a pruned checkpoint reports events_journal_truncated with floor and head', () => {
    const truncated = loadFixture<RecordedFailure>('1.3.1', 'events-tail-truncated.json');
    assert.strictEqual(truncated.exitCode, 1);
    const body = truncated.stdout as { code: string; floor: number; head: number; since: number };
    assert.strictEqual(body.code, 'events_journal_truncated');
    assert.strictEqual(body.since, 0);
    assert.ok(body.floor > body.since);
    assert.ok(body.head >= body.floor);
  });
});
