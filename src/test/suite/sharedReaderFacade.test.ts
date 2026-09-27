import * as assert from 'assert';
import type * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';
import { FIXED_TIME, defaultCard, defaultFullCard, listFixture, showFixture, expectedShowCard } from '../shared/readerFixtures';

suite('Shared reader facade characterization', () => {
  let adapter: DaemonBeadsAdapter;
  let calls: string[][];
  let logs: string[];
  let result: unknown;
  let failure: unknown;
  const NativeDate = Date;

  setup(() => {
    global.Date = class extends NativeDate {
      constructor() { super(FIXED_TIME); }
      static now() { return new NativeDate(FIXED_TIME).getTime(); }
    } as DateConstructor;
    calls = [];
    logs = [];
    failure = undefined;
    result = [];
    adapter = new DaemonBeadsAdapter('/unused', { appendLine: (line: string) => logs.push(line) } as unknown as vscode.OutputChannel);
    (adapter as any).execBd = async (args: string[]) => {
      calls.push(args);
      if (failure !== undefined) { throw failure; }
      return result;
    };
  });

  teardown(() => { global.Date = NativeDate; });

  test('list and detail defaults are golden, including missing-status readiness', async () => {
    result = [{ id: 'test-empty' }];
    assert.deepStrictEqual(await adapter.getBoardMinimal(), [defaultCard]);
    assert.deepStrictEqual(await adapter.getIssueFull('test-empty'), defaultFullCard);
    assert.deepStrictEqual(calls, [
      ['list', '--json', '--all', '--limit', '5000'], ['show', '--json', 'test-empty']
    ]);
    assert.strictEqual((adapter as any).lastInteractionTime, Date.now());
    assert.deepStrictEqual(logs, [
      '[DaemonBeadsAdapter] getBoardMinimal: Loaded 1 enriched cards',
      '[DaemonBeadsAdapter] getIssueFull: Loaded full details for test-empty'
    ]);
  });

  test('list edges reverse-index independently of top-level parent', async () => {
    result = listFixture;
    const cards = await adapter.getBoardMinimal(7);
    const parentRef = { id: 'test-parent', title: 'Parent', created_at: 'yesterday', created_by: 'unknown' };
    const childRef = { id: 'test-child', title: 'test-child', created_at: undefined, created_by: 'unknown' };
    assert.deepStrictEqual(cards, [
      { ...defaultCard, id: 'test-parent', title: 'Parent', created_at: 'yesterday', updated_at: 'yesterday', is_ready: true, blocks: [childRef] },
      { ...defaultCard, id: 'test-child', labels: ['one'], pinned: true, parent: parentRef, blocked_by: [parentRef] },
      { ...defaultCard, id: 'test-other', children: [childRef] }
    ]);
    assert.deepStrictEqual(calls, [['list', '--json', '--all', '--limit', '7']]);
  });

  test('show relationships, labels, comments and metadata are golden', async () => {
    result = [showFixture, { id: 'test-ignored' }];
    assert.deepStrictEqual(await adapter.getIssueFull('test-child'), expectedShowCard);
    result = [{ id: 'test-empty', parent: 'test-parent' }];
    assert.deepStrictEqual(await adapter.getIssueFull('test-empty'), defaultFullCard);
  });

  test('empty and non-array envelopes retain their logs and errors', async () => {
    for (const value of [[], null, {}]) {
      result = value;
      assert.deepStrictEqual(await adapter.getBoardMinimal(), []);
      await assert.rejects(adapter.getIssueFull('test-empty'), { message: 'Failed to get full issue details: Issue not found: test-empty' });
    }
    assert.deepStrictEqual(logs, [
      '[DaemonBeadsAdapter] getBoardMinimal: Loaded 0 enriched cards',
      '[DaemonBeadsAdapter] getBoardMinimal: bd list returned non-array',
      '[DaemonBeadsAdapter] getBoardMinimal: bd list returned non-array'
    ]);
  });

  test('execution errors are wrapped and valid attempted reads track interaction', async () => {
    failure = new Error('no issue found in store');
    await assert.rejects(adapter.getIssueFull('test-empty'), { message: 'Failed to get full issue details: Issue not found: test-empty' });
    assert.strictEqual((adapter as any).lastInteractionTime, Date.now());
    failure = 'offline';
    await assert.rejects(adapter.getBoardMinimal(), { message: 'Failed to get minimal board data: offline' });
    await assert.rejects(adapter.getIssueFull('test-empty'), { message: 'Failed to get full issue details: offline' });
  });

  test('invalid ids fail before execution or interaction', async () => {
    await assert.rejects(adapter.getIssueFull('--bad'), { message: 'Failed to get full issue details: Invalid issue ID: cannot start with hyphen (--bad)' });
    assert.deepStrictEqual(calls, []);
    assert.strictEqual((adapter as any).lastInteractionTime, 0);
  });
});
