import * as assert from 'assert';
import { BeadsReader } from '../../shared/beadsReader';
import { ISSUE_ID_PATTERN, validateIssueId } from '../../shared/model';
import { mapBdListIssuesToEnrichedCards } from '../../shared/issueMapping';
import { FIXED_TIME, defaultCard, defaultFullCard, showFixture, expectedShowCard } from './readerFixtures';

suite('Independent shared reader', () => {
  const NativeDate = Date;
  setup(() => {
    global.Date = class extends NativeDate {
      constructor() { super(FIXED_TIME); }
    } as DateConstructor;
  });
  teardown(() => { global.Date = NativeDate; });

  test('injected executor receives list and show arguments and returns golden defaults', async () => {
    const calls: string[][] = [];
    const reader = new BeadsReader(async args => {
      calls.push(args);
      return [{ id: 'test-empty' }];
    });
    assert.deepStrictEqual(await reader.getBoardMinimal(), [defaultCard]);
    assert.deepStrictEqual(await reader.getIssueFull('test-empty'), defaultFullCard);
    assert.deepStrictEqual(calls, [
      ['list', '--json', '--all', '--limit', '5000'], ['show', '--json', 'test-empty']
    ]);
  });

  test('detail golden fixture includes relationship direction and metadata precedence', async () => {
    const reader = new BeadsReader(async () => [showFixture]);
    assert.deepStrictEqual(await reader.getIssueFull('test-child'), expectedShowCard);
  });

  test('list preserves duplicate edges, missing references, and self-edge asymmetry', () => {
    const cards = mapBdListIssuesToEnrichedCards([{
      id: 'test-child', status: 'open', dependencies: [
        { issue_id: 'test-child', depends_on_id: 'test-missing', type: 'parent-child' },
        { issue_id: 'test-child', depends_on_id: 'test-missing', type: 'blocks' },
        { issue_id: 'test-child', depends_on_id: 'test-missing', type: 'blocks' },
        { issue_id: 'test-child', depends_on_id: 'test-child', type: 'blocks' }
      ]
    }]);
    const missing = { id: 'test-missing', title: 'test-missing', created_at: undefined, created_by: 'unknown' };
    assert.deepStrictEqual(cards, [{
      ...defaultCard, id: 'test-child', is_ready: true, parent: missing,
      blocked_by: [missing, missing],
      blocks: [{ id: 'test-child', title: 'test-child', created_at: undefined, created_by: 'unknown' }]
    }]);
  });

  test('compatibility mode tolerates non-array list envelopes and selects first show issue', async () => {
    let notifications = 0;
    const reader = new BeadsReader(async () => ({}), { onNonArrayList: () => notifications++ });
    assert.deepStrictEqual(await reader.getBoardMinimal(), []);
    assert.strictEqual(notifications, 1);
    await assert.rejects(reader.getIssueFull('test-empty'), { message: 'Issue not found: test-empty' });
    const firstOnly = new BeadsReader(async () => [{ id: 'test-empty' }, null]);
    assert.deepStrictEqual(await firstOnly.getIssueFull('test-empty'), defaultFullCard);
  });

  test('strict envelope validation rejects non-arrays and every malformed issue entry', async () => {
    for (const value of [null, {}, 'text', [null], [[]], [3], [{}], [{ id: '' }], [{ id: 2 }], [{ id: 'test-empty' }, null]]) {
      const reader = new BeadsReader(async () => value, { strict: true });
      await assert.rejects(reader.getBoardMinimal(), { message: 'Invalid bd list response: expected an array of issue objects with non-empty string ids' });
      await assert.rejects(reader.getIssueFull('test-empty'), { message: 'Invalid bd show response: expected an array of issue objects with non-empty string ids' });
    }
  });

  test('strict envelopes accept empty lists and sparse valid objects without validating issue fields', async () => {
    const empty = new BeadsReader(async () => [], { strict: true });
    assert.deepStrictEqual(await empty.getBoardMinimal(), []);
    await assert.rejects(empty.getIssueFull('test-empty'), { message: 'Issue not found: test-empty' });
    const sparse = new BeadsReader(async () => [{ id: 'test-empty' }], { strict: true });
    assert.deepStrictEqual(await sparse.getIssueFull('test-empty'), defaultFullCard);
  });

  test('read errors preserve identity except no-issue-found normalization', async () => {
    const failure = new Error('offline');
    const reader = new BeadsReader(async () => { throw failure; });
    await assert.rejects(reader.getBoardMinimal(), error => error === failure);
    await assert.rejects(reader.getIssueFull('test-empty'), error => error === failure);
    const missing = new BeadsReader(async () => { throw new Error('no issue found here'); });
    await assert.rejects(missing.getIssueFull('test-empty'), { message: 'Issue not found: test-empty' });
  });

  test('validation supports custom hierarchical ids and rejects invalid ids before executing', async () => {
    for (const id of ['stuff-30m.1.4.9', 'my-org.beads-xyz', 'BBK-123']) {
      assert.strictEqual(ISSUE_ID_PATTERN.test(id), true);
      assert.doesNotThrow(() => validateIssueId(id));
    }
    let calls = 0;
    const reader = new BeadsReader(async () => { calls++; return []; });
    const cases = [
      ['', 'Issue ID must be a non-empty string'],
      ['--flag', 'Invalid issue ID: cannot start with hyphen (--flag)'],
      ['test-a b', 'Invalid issue ID: whitespace not allowed (test-a b)'],
      ['test-..', 'Invalid issue ID format: test-... Expected format: prefix-xxxx or project.prefix-xxxx']
    ];
    for (const [id, message] of cases) {
      await assert.rejects(reader.getIssueFull(id), { message });
    }
    assert.strictEqual(calls, 0);
  });
});
