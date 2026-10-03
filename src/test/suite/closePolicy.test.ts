import * as assert from 'assert';
import type * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';
import { capabilitiesFor, parseBdVersion } from '../../shared/node';
import { IssueUpdateSchema, SetStatusSchema } from '../../types';

suite('Close-policy force: schemas', () => {
    test('a drag may carry force only when it closes', () => {
        assert.ok(SetStatusSchema.safeParse({ id: 'fx-a1', status: 'closed', force: true }).success);
        assert.ok(SetStatusSchema.safeParse({ id: 'fx-a1', status: 'closed' }).success);
        assert.ok(!SetStatusSchema.safeParse({ id: 'fx-a1', status: 'in_progress', force: true }).success);
        assert.ok(!SetStatusSchema.safeParse({ id: 'fx-a1', status: 'closed', force: 'yes' }).success);
    });

    test('an edit-dialog save may carry force only when it closes', () => {
        assert.ok(IssueUpdateSchema.safeParse({ id: 'fx-a1', updates: { status: 'closed', title: 'Done' }, force: true }).success);
        assert.ok(!IssueUpdateSchema.safeParse({ id: 'fx-a1', updates: { title: 'Done' }, force: true }).success);
        assert.ok(!IssueUpdateSchema.safeParse({ id: 'fx-a1', updates: { status: 'open' }, force: true }).success);
        assert.ok(IssueUpdateSchema.safeParse({ id: 'fx-a1', updates: { status: 'open' }, force: false }).success);
    });
});

suite('Close-policy force: bd arguments', () => {
    let calls: string[][];

    function adapterFor(version: string): DaemonBeadsAdapter {
        const adapter = new DaemonBeadsAdapter('/unused', { appendLine: () => undefined } as unknown as vscode.OutputChannel);
        (adapter as any).ensureStoreReady = async () => capabilitiesFor(parseBdVersion(version));
        (adapter as any).execBd = async (args: string[]) => { calls.push(args); return null; };
        return adapter;
    }

    setup(() => { calls = []; });

    test('a forced close on bd 1.3 passes --force', async () => {
        await adapterFor('1.3.1').setIssueStatus('fx-a1', 'closed', { force: true });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--status', 'closed', '--force']]);
    });

    test('a close without force never passes --force', async () => {
        await adapterFor('1.3.1').setIssueStatus('fx-a1', 'closed');
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--status', 'closed']]);
    });

    test('force is ignored for any status but closed', async () => {
        await adapterFor('1.3.1').setIssueStatus('fx-a1', 'in_progress', { force: true });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--status', 'in_progress']]);
    });

    test('bd 1.2.2, which has no close policy, never gets --force', async () => {
        await adapterFor('1.2.2').setIssueStatus('fx-a1', 'closed', { force: true });
        await adapterFor('1.2.2').updateIssue('fx-a1', { status: 'closed' }, { force: true });
        assert.deepStrictEqual(calls, [
            ['update', 'fx-a1', '--status', 'closed'],
            ['update', 'fx-a1', '--status', 'closed']
        ]);
    });

    test('a forced edit-dialog close keeps the other fields and adds --force once', async () => {
        await adapterFor('1.3.1').updateIssue('fx-a1', { title: 'Done', status: 'closed' }, { force: true });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--title', 'Done', '--status', 'closed', '--force']]);
    });

    test('an edit-dialog save that does not close never passes --force', async () => {
        await adapterFor('1.3.1').updateIssue('fx-a1', { title: 'Renamed' }, { force: true });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--title', 'Renamed']]);
    });
});
