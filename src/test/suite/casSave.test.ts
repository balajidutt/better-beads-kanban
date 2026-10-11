import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';
import { BdCommandError, capabilitiesFor, isGuardMismatch, parseBdVersion } from '../../shared/node';
import { IssueUpdateSchema } from '../../types';

suite('Compare-and-set saves from the edit dialog: schema', () => {
    test('fromStatus is accepted with a status change, including custom statuses', () => {
        for (const fromStatus of ['open', 'in_progress', 'review', 'needs-qa']) {
            assert.ok(IssueUpdateSchema.safeParse({ id: 'fx-a1', updates: { status: 'closed' }, fromStatus }).success, fromStatus);
        }
    });

    test('fromStatus without a status change is refused on the fromStatus field', () => {
        const result = IssueUpdateSchema.safeParse({ id: 'fx-a1', updates: { title: 'Renamed' }, fromStatus: 'open' });
        assert.ok(!result.success);
        assert.deepStrictEqual(result.error.issues.map(issue => issue.path), [['fromStatus']]);
    });

    test('fromStatus rejects anything that could be read as a flag or is not a token', () => {
        for (const fromStatus of ['', '-x', '--help', 'in progress', 'a;b', 'x'.repeat(65), 7]) {
            assert.ok(!IssueUpdateSchema.safeParse({ id: 'fx-a1', updates: { status: 'closed' }, fromStatus }).success, String(fromStatus));
        }
    });

    test('a forced close can carry fromStatus', () => {
        assert.ok(IssueUpdateSchema.safeParse({ id: 'fx-a1', updates: { status: 'closed' }, force: true, fromStatus: 'blocked' }).success);
    });
});

suite('Compare-and-set saves from the edit dialog: bd arguments', () => {
    let calls: string[][];
    let failWith: unknown;

    function adapterFor(version: string): DaemonBeadsAdapter {
        const adapter = new DaemonBeadsAdapter('/unused', { appendLine: () => undefined } as unknown as vscode.OutputChannel);
        (adapter as any).ensureStoreReady = async () => capabilitiesFor(parseBdVersion(version));
        (adapter as any).execBd = async (args: string[]) => {
            calls.push(args);
            if (failWith) { throw failWith; }
            return null;
        };
        return adapter;
    }

    setup(() => { calls = []; failWith = undefined; });

    test('bd 1.3 gets --if-status when the save changes the status', async () => {
        await adapterFor('1.3.1').updateIssue('fx-a1', { title: 'Renamed', status: 'closed' }, { ifStatus: 'open' });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--title', 'Renamed', '--status', 'closed', '--if-status', 'open']]);
    });

    test('bd 1.2.2, which has no --if-status, gets a plain update', async () => {
        await adapterFor('1.2.2').updateIssue('fx-a1', { status: 'closed' }, { ifStatus: 'open' });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--status', 'closed']]);
    });

    test('a save that does not change the status never sends --if-status', async () => {
        await adapterFor('1.3.1').updateIssue('fx-a1', { title: 'Renamed' }, { ifStatus: 'open' });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--title', 'Renamed']]);
    });

    test('the separate ephemeral call never carries --if-status', async () => {
        await adapterFor('1.3.1').updateIssue('fx-a1', { status: 'in_progress', ephemeral: true }, { ifStatus: 'open' });
        assert.deepStrictEqual(calls, [
            ['update', 'fx-a1', '--status', 'in_progress', '--if-status', 'open'],
            ['update', 'fx-a1', '--ephemeral']
        ]);
    });

    test('a forced close keeps the compare-and-set', async () => {
        await adapterFor('1.3.1').updateIssue('fx-a1', { status: 'closed' }, { force: true, ifStatus: 'blocked' });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--status', 'closed', '--force', '--if-status', 'blocked']]);
    });

    test('a status that would read as a flag is refused before bd runs', async () => {
        await assert.rejects(adapterFor('1.3.1').updateIssue('fx-a1', { status: 'closed' }, { ifStatus: '--force' }), /cannot start with hyphen/);
        assert.deepStrictEqual(calls, []);
    });

    test('a mismatch stays recognisable through the adapter error, and the ephemeral call is skipped', async () => {
        failWith = new BdCommandError('bd command failed with exit code 13', { exitCode: 13, stderr: '', stdout: '', args: [] });
        await assert.rejects(
            adapterFor('1.3.1').updateIssue('fx-a1', { status: 'closed', ephemeral: true }, { ifStatus: 'open' }),
            (error: unknown) => isGuardMismatch(error)
        );
        assert.strictEqual(calls.length, 1);
    });
});

// Source checks only: the host handler and the webview have no unit harness; the dialog flow is covered in the Chrome mock harness.
suite('Compare-and-set saves from the edit dialog: host and webview wiring', () => {
    const root = path.resolve(__dirname, '..', '..', '..');
    const read = (...parts: string[]) => fs.readFileSync(path.join(root, ...parts), 'utf8');
    let extensionTs: string;
    let boardJs: string;

    suiteSetup(() => {
        extensionTs = read('src', 'extension.ts');
        boardJs = read('src', 'webview', 'board.js');
    });

    const between = (source: string, start: string, end: string) => {
        const from = source.indexOf(start);
        const to = source.indexOf(end, from);
        assert.ok(from > 0 && to > from, `${start} not found`);
        return source.slice(from, to);
    };

    test('the host passes fromStatus to bd and posts status_changed before re-sending the board', () => {
        const handler = between(extensionTs, 'if (msg.type === "issue.update") {', 'if (msg.type === "issue.claim"');
        assert.match(handler, /adapter\.updateIssue\(validation\.data\.id, validation\.data\.updates, \{\s*force: validation\.data\.force, ifStatus: validation\.data\.fromStatus\s*\}\)/);
        const mismatch = between(handler, 'if (validation.data.fromStatus && isGuardMismatch(e)) {', 'return;');
        const error = mismatch.indexOf('code: "status_changed"');
        const board = mismatch.indexOf('await sendBoard(msg.requestId);');
        assert.ok(error > 0 && board > error, 'the refusal must be posted before the board, or the board resolves the pending save');
    });

    test('a pending status_changed rejects with its code and leaves the message to the dialog', () => {
        const handler = between(boardJs, 'if (msg.type === "mutation.error") {', 'if (msg.type === "table.pageData")');
        assert.match(handler, /if \(!\(\(closeRefused \|\| statusChanged\) && pending\)\) \{\s*toast\(msg\.error \|\| "Operation failed\."\);/);
        assert.match(handler, /if \(statusChanged\) \{ error\.code = "status_changed"; \}/);
    });

    test('the dialog guards a status change with the status it expects and re-reads the issue on a mismatch', () => {
        const dialog = between(boardJs, 'async function openDetail(card) {', '// Claim-lease actions');
        assert.match(dialog, /let expectedStatus = isCreateMode \? undefined : statusToken\(card\.status\);/);
        assert.match(dialog, /if \(data\.status !== undefined && expectedStatus\) \{ updatePayload\.fromStatus = expectedStatus; \}/);
        assert.match(dialog, /err\.code === "status_changed" && statusChangedNotice && isCurrentDialog\(\)\) \{\s*await showStatusChanged\(\);/);
        assert.match(dialog, /cardStateLevel\.delete\(card\.id\);\s*const fresh = await loadFullIssue\(card\.id\);\s*if \(!isCurrentDialog\(\)\) \{ return; \}\s*expectedStatus = statusToken\(fresh\.status\);/);
        assert.match(dialog, /editBaselineValues\.status = statusOptions\.includes\(fresh\.status\) \? fresh\.status : "";/, 'choosing the stored status again must still count as a change');
    });

    test('the mock harness carries the same status notice markup as the shipped dialog', () => {
        const markup = '<div id="statusChanged" class="status-changed hidden" role="alert"></div>';
        assert.ok(read('src', 'webview.ts').includes(markup));
        assert.ok(read('scripts', 'visual-test-server.js').includes(markup));
    });
});
