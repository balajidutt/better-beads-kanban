import * as assert from 'assert';
import {
  BdCommandError, findBdCommandError, isClosePolicyRefusal, isEventsJournalTruncated, isEventsTableMissing,
  isGuardMismatch, isMaxRowsExceeded, isPendingMigration
} from '../../shared/node';
import { RecordedBdVersion, RecordedFailure, loadFixture } from './bdFixtures';

function fromFixture(version: RecordedBdVersion, name: string): BdCommandError {
  const recorded = loadFixture<RecordedFailure>(version, name);
  const stdout = typeof recorded.stdout === 'string' ? recorded.stdout : JSON.stringify(recorded.stdout);
  return new BdCommandError('bd command failed', { exitCode: recorded.exitCode, stderr: recorded.stderr, stdout, args: recorded.args });
}

function synthetic(exitCode: number, stderr: string): BdCommandError {
  return new BdCommandError('bd command failed', { exitCode, stderr, stdout: '', args: [] });
}

suite('BdCommandError classification', () => {
  test('findBdCommandError follows the cause chain and stops on cycles', () => {
    const bdError = synthetic(1, 'boom');
    const wrapped = new Error('Failed to update status: boom', { cause: new Error('middle', { cause: bdError }) });
    assert.strictEqual(findBdCommandError(wrapped), bdError);
    const cyclic = new Error('a') as Error & { cause?: unknown };
    cyclic.cause = cyclic;
    assert.strictEqual(findBdCommandError(cyclic), undefined);
    assert.strictEqual(findBdCommandError('plain string'), undefined);
  });

  test('recorded 1.3.1 close refusals are close-policy refusals', () => {
    assert.ok(isClosePolicyRefusal(fromFixture('1.3.1', 'close-refused-children.json')));
    assert.ok(isClosePolicyRefusal(fromFixture('1.3.1', 'close-refused-blocker.json')));
    assert.ok(!isGuardMismatch(fromFixture('1.3.1', 'close-refused-children.json')));
  });

  test('recorded --if-status mismatch is a guard mismatch only on 1.3.1', () => {
    assert.ok(isGuardMismatch(fromFixture('1.3.1', 'if-status-mismatch.json')));
    assert.ok(!isClosePolicyRefusal(fromFixture('1.3.1', 'if-status-mismatch.json')));
    assert.ok(!isGuardMismatch(fromFixture('1.2.2', 'if-status-mismatch.json')));
  });

  test('recorded BEADS_MAX_ROWS overflow is classified', () => {
    assert.ok(isMaxRowsExceeded(fromFixture('1.3.1', 'max-rows.json')));
    assert.ok(!isMaxRowsExceeded(fromFixture('1.3.1', 'close-refused-children.json')));
  });

  test('recorded journal truncation is classified', () => {
    assert.ok(isEventsJournalTruncated(fromFixture('1.3.1', 'events-tail-truncated.json')));
    assert.ok(!isEventsJournalTruncated(fromFixture('1.3.1', 'max-rows.json')));
  });

  test('pending-migration and missing-events-table texts from the 1.3 binary and release notes are classified', () => {
    assert.ok(isPendingMigration(synthetic(1, 'Error: 3 pending schema migration(s) on a shared server database, no consent')));
    assert.ok(isPendingMigration(synthetic(1, 'Error: 2 pending schema migration(s) and a configured remote')));
    assert.ok(isEventsTableMissing(synthetic(1, 'Error 1146: table not found: events')));
    assert.ok(!isEventsTableMissing(synthetic(1, 'Error 1146: table not found: events_journal')));
  });

  test('the warning bd prints while applying migrations is not a pending-migration refusal', () => {
    for (const count of ['3', '12']) {
      const warning = `Warning: applying ${count} pending schema migration(s) to a shared server database (fx); co-resident bd clients still on an older binary will refuse this database until they are upgraded (#5920)\nError: something else`;
      assert.ok(!isPendingMigration(synthetic(1, warning)), count);
    }
  });

  test('a close-like message with another exit code or a non-policy reason is not a close refusal', () => {
    assert.ok(!isClosePolicyRefusal(synthetic(2, 'cannot close x-1: 1 open child issue(s)')));
    assert.ok(!isClosePolicyRefusal(new Error('cannot close x-1: 1 open child issue(s)')));
    assert.ok(!isClosePolicyRefusal(synthetic(1, 'cannot close x-1: database is read-only')));
  });
});
