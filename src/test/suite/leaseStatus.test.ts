import * as assert from 'assert';
import { assigneeBadge, leaseActionVisibility, leaseState } from '../../webview/leaseStatus';
import { loadFixture, SeededIds } from '../shared/bdFixtures';

const NOW = Date.parse('2026-10-03T10:00:00Z');

suite('Lease state', () => {
    test('a live lease shows minutes left, rounded up', () => {
        assert.deepStrictEqual(leaseState({ status: 'in_progress', lease_expires_at: '2026-10-03T10:04:01Z' }, NOW),
            { text: 'lease 5m', expired: false, expiresAt: '2026-10-03T10:04:01Z' });
        assert.strictEqual(leaseState({ status: 'in_progress', lease_expires_at: '2026-10-03T10:00:30Z' }, NOW)?.text, 'lease 1m');
    });

    test('long leases show hours and minutes', () => {
        assert.strictEqual(leaseState({ status: 'in_progress', lease_expires_at: '2026-10-03T12:00:00Z' }, NOW)?.text, 'lease 2h');
        assert.strictEqual(leaseState({ status: 'in_progress', lease_expires_at: '2026-10-03T11:30:00Z' }, NOW)?.text, 'lease 1h 30m');
    });

    test('a lease at or past its expiry is expired', () => {
        assert.deepStrictEqual(leaseState({ status: 'in_progress', lease_expires_at: '2026-10-03T10:00:00Z' }, NOW),
            { text: 'lease expired', expired: true, expiresAt: '2026-10-03T10:00:00Z' });
        assert.strictEqual(leaseState({ status: 'in_progress', lease_expires_at: '2026-10-03T09:00:00Z' }, NOW)?.expired, true);
    });

    test('only in-progress cards with a parseable lease get a state', () => {
        assert.strictEqual(leaseState({ status: 'open', lease_expires_at: '2026-10-03T10:05:00Z' }, NOW), null);
        assert.strictEqual(leaseState({ status: 'in_progress' }, NOW), null);
        assert.strictEqual(leaseState({ status: 'in_progress', lease_expires_at: 'soon' }, NOW), null);
    });

    test('the recorded bd 1.3.1 claim reads as a live lease when read at its heartbeat', () => {
        const ids = loadFixture<SeededIds>('1.3.1', 'ids.json');
        const claimed = loadFixture<Array<Record<string, string>>>('1.3.1', 'list-all.json').find(i => i.id === ids.claimed)!;
        const state = leaseState(claimed, Date.parse(claimed.heartbeat_at));
        assert.strictEqual(state?.expired, false);
        assert.match(state?.text ?? '', /^lease \d+m$/);
    });
});

suite('Assignee badge', () => {
    test('unassigned, assigned without a lease, live lease and expired lease', () => {
        assert.deepStrictEqual(assigneeBadge({ status: 'open' }, NOW), { text: 'Assignee: Unassigned', cls: 'badge-assignee badge-unassigned' });
        assert.deepStrictEqual(assigneeBadge({ status: 'open', assignee: 'bob' }, NOW), { text: 'Assignee: bob', cls: 'badge-assignee' });
        const live = assigneeBadge({ status: 'in_progress', assignee: 'bob', lease_expires_at: '2026-10-03T10:03:00Z' }, NOW);
        assert.strictEqual(live.text, 'Assignee: bob · lease 3m');
        assert.strictEqual(live.cls, 'badge-assignee');
        assert.match(live.title ?? '', /^Lease expires /);
        const expired = assigneeBadge({ status: 'in_progress', assignee: 'bob', lease_expires_at: '2026-10-03T09:58:00Z' }, NOW);
        assert.strictEqual(expired.text, 'Assignee: bob · lease expired');
        assert.strictEqual(expired.cls, 'badge-assignee badge-lease-expired');
        assert.match(expired.title ?? '', /^Lease expired /);
    });

    test('the same card turns expired as time passes, which the periodic refresh relies on', () => {
        const card = { status: 'in_progress', assignee: 'bob', lease_expires_at: '2026-10-03T10:01:00Z' };
        assert.strictEqual(assigneeBadge(card, NOW).text, 'Assignee: bob · lease 1m');
        assert.strictEqual(assigneeBadge(card, NOW + 2 * 60000).text, 'Assignee: bob · lease expired');
    });
});

suite('Lease action visibility', () => {
    const on = { readOnly: false, leases: true, isCreateMode: false };

    test('an open unassigned issue offers only Claim', () => {
        assert.deepStrictEqual(leaseActionVisibility({ status: 'open' }, on), { row: true, claim: true, unclaim: false, heartbeat: false });
    });

    test('a claimed issue with a lease offers Release and Extend', () => {
        assert.deepStrictEqual(leaseActionVisibility({ status: 'in_progress', assignee: 'bob', lease_expires_at: '2026-10-03T10:05:00Z' }, on),
            { row: true, claim: false, unclaim: true, heartbeat: true });
    });

    test('issues no action applies to hide the whole row', () => {
        for (const card of [{ status: 'closed' }, { status: 'blocked' }, { status: 'open', assignee: 'bob' }, { status: 'deferred' }]) {
            assert.deepStrictEqual(leaseActionVisibility(card, on), { row: false, claim: false, unclaim: false, heartbeat: false }, card.status);
        }
    });

    test('read-only mode, bd without leases and create mode hide everything', () => {
        const card = { status: 'in_progress', assignee: 'bob', lease_expires_at: '2026-10-03T10:05:00Z' };
        for (const context of [{ ...on, readOnly: true }, { ...on, leases: false }, { ...on, isCreateMode: true }]) {
            assert.strictEqual(leaseActionVisibility(card, context).row, false);
        }
    });
});
