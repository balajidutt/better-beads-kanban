import * as assert from 'assert';
import type * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';
import { sanitizeErrorWithContext } from '../../sanitizeError';
import { BdCommandError, findBdCommandError, isClosePolicyRefusal } from '../../shared/node';
import { RecordedFailure, loadFixture } from '../shared/bdFixtures';

function recorded(name: string): BdCommandError {
  const failure = loadFixture<RecordedFailure>('1.3.1', name);
  const stdout = typeof failure.stdout === 'string' ? failure.stdout : JSON.stringify(failure.stdout);
  return new BdCommandError(`bd command failed with exit code ${failure.exitCode}: ${failure.stderr}`, {
    exitCode: failure.exitCode, stderr: failure.stderr, stdout, args: failure.args
  });
}

suite('bd 1.3 refusals through the adapter and error messages', () => {
  let adapter: DaemonBeadsAdapter;
  let failure: unknown;

  setup(() => {
    failure = undefined;
    adapter = new DaemonBeadsAdapter('/unused', { appendLine: () => undefined } as unknown as vscode.OutputChannel);
    (adapter as any).execBd = async () => {
      if (failure !== undefined) { throw failure; }
      return null;
    };
  });

  test('a refused status change keeps its message prefix and the BdCommandError as cause', async () => {
    failure = recorded('close-refused-children.json');
    await assert.rejects(adapter.setIssueStatus('fx-a1', 'closed'), (error: Error) => {
      assert.match(error.message, /^Failed to update status: bd command failed with exit code 1/);
      assert.strictEqual(findBdCommandError(error), failure);
      assert.ok(isClosePolicyRefusal(error));
      return true;
    });
  });

  test('a refused edit-dialog update keeps the BdCommandError as cause', async () => {
    failure = recorded('close-refused-blocker.json');
    await assert.rejects(adapter.updateIssue('fx-a1', { status: 'closed' }), (error: Error) => {
      assert.match(error.message, /^Failed to update issue:/);
      assert.ok(isClosePolicyRefusal(error));
      return true;
    });
  });

  test('close refusals name bd\'s reason without its --force advice', () => {
    const children = sanitizeErrorWithContext(new Error('Failed to update status', { cause: recorded('close-refused-children.json') }));
    assert.match(children, /^Close refused: cannot close fx-[a-z0-9]+: 1 open child issue\(s\)\.$/);
    assert.doesNotMatch(children, /--force/);
    const blocker = sanitizeErrorWithContext(recorded('close-refused-blocker.json'));
    assert.match(blocker, /^Close refused: cannot close blocked issue: fx-[a-z0-9]+ is blocked by \[fx-[a-z0-9]+\]\.$/);
  });

  test('the close reason scrubs paths and is capped', () => {
    const withPath = new BdCommandError('bd command failed with exit code 1', {
      exitCode: 1, stderr: 'cannot close blocked issue: x-1 is blocked by [x-2] in /Users/someone/repo/.beads/embeddeddolt', stdout: '', args: []
    });
    const message = sanitizeErrorWithContext(withPath);
    assert.doesNotMatch(message, /\/Users\/someone/);
    assert.match(message, /\[PATH\]/);
    const long = new BdCommandError('bd command failed with exit code 1', {
      exitCode: 1, stderr: `cannot close blocked issue: x-1 is blocked by [${Array.from({ length: 100 }, (_, i) => `x-${i}`).join(' ')}]`, stdout: '', args: []
    });
    assert.ok(sanitizeErrorWithContext(long).length <= 'Close refused: .'.length + 200);
  });

  test('guard mismatch, max-rows and journal truncation get their own messages', () => {
    assert.match(sanitizeErrorWithContext(recorded('if-status-mismatch.json')), /changed elsewhere since the board loaded/);
    assert.match(sanitizeErrorWithContext(recorded('max-rows.json')), /BEADS_MAX_ROWS is lower than the number of matching issues/);
    assert.match(sanitizeErrorWithContext(recorded('events-tail-truncated.json')), /events journal was pruned/);
  });

  test('pending migrations and the #6142 missing events table get their own messages', () => {
    const pending = new BdCommandError('bd command failed with exit code 1', {
      exitCode: 1, stderr: 'Error: 3 pending schema migration(s) on a shared server database, no consent', stdout: '', args: []
    });
    assert.match(sanitizeErrorWithContext(pending), /bd migrate schema/);
    const missing = new BdCommandError('bd command failed with exit code 1', {
      exitCode: 1, stderr: 'Error 1146: table not found: events', stdout: '', args: []
    });
    assert.match(sanitizeErrorWithContext(missing), /Upgrade bd to 1\.3\.1/);
  });

  test('the shared runner\'s "timed out" message is reported as a timeout', () => {
    assert.match(sanitizeErrorWithContext(new Error('Command timed out after 30000ms: bd list --json')), /^Operation timed out\./);
  });

  test('no message tells the user to start the removed bd daemon', () => {
    for (const input of ['daemon not running', 'connect ECONNREFUSED 127.0.0.1:3307', 'Command timed out after 30000ms: bd list']) {
      assert.doesNotMatch(sanitizeErrorWithContext(new Error(input)), /bd daemon start|start the daemon|daemon status|daemon is running|status bar/i);
    }
  });

  test('a plain bd failure with no refusal text still gets the generic message', () => {
    const generic = new BdCommandError('bd command failed with exit code 1: something odd', {
      exitCode: 1, stderr: 'something odd', stdout: '', args: []
    });
    assert.match(sanitizeErrorWithContext(generic), /^bd command failed with exit code 1: something odd\. If this persists/);
  });
});
