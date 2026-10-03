import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';
import { capabilitiesFor, parseBdVersion } from '../../shared/node';
import { SetStatusSchema } from '../../types';

suite('Compare-and-set moves: schema', () => {
    test('fromStatus accepts built-in and custom status tokens', () => {
        for (const fromStatus of ['open', 'in_progress', 'deferred', 'review', 'needs-qa']) {
            assert.ok(SetStatusSchema.safeParse({ id: 'fx-a1', status: 'closed', fromStatus }).success, fromStatus);
        }
        assert.ok(SetStatusSchema.safeParse({ id: 'fx-a1', status: 'closed' }).success);
    });

    test('fromStatus rejects anything that could be read as a flag or is not a token', () => {
        for (const fromStatus of ['', '-x', '--help', 'in progress', 'a;b', 'x'.repeat(65), 7]) {
            assert.ok(!SetStatusSchema.safeParse({ id: 'fx-a1', status: 'closed', fromStatus }).success, String(fromStatus));
        }
    });
});

suite('Compare-and-set moves: bd arguments', () => {
    let calls: string[][];

    function adapterFor(version: string): DaemonBeadsAdapter {
        const adapter = new DaemonBeadsAdapter('/unused', { appendLine: () => undefined } as unknown as vscode.OutputChannel);
        (adapter as any).ensureStoreReady = async () => capabilitiesFor(parseBdVersion(version));
        (adapter as any).execBd = async (args: string[]) => { calls.push(args); return null; };
        return adapter;
    }

    setup(() => { calls = []; });

    test('bd 1.3 gets --if-status with the card\'s stored status', async () => {
        await adapterFor('1.3.1').setIssueStatus('fx-a1', 'in_progress', { ifStatus: 'open' });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--status', 'in_progress', '--if-status', 'open']]);
    });

    test('bd 1.2.2, which has no --if-status, gets a plain update', async () => {
        await adapterFor('1.2.2').setIssueStatus('fx-a1', 'in_progress', { ifStatus: 'open' });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--status', 'in_progress']]);
    });

    test('a forced close keeps the compare-and-set', async () => {
        await adapterFor('1.3.1').setIssueStatus('fx-a1', 'closed', { force: true, ifStatus: 'blocked' });
        assert.deepStrictEqual(calls, [['update', 'fx-a1', '--status', 'closed', '--force', '--if-status', 'blocked']]);
    });

    test('a status that would read as a flag is refused before bd runs', async () => {
        await assert.rejects(adapterFor('1.3.1').setIssueStatus('fx-a1', 'closed', { ifStatus: '--force' }), /cannot start with hyphen/);
        assert.deepStrictEqual(calls, []);
    });
});

suite('Compare-and-set moves: webview and schema agree', () => {
    test('the webview filters fromStatus with the same pattern and limit the host validates', () => {
        const read = (...parts: string[]) => fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'src', ...parts), 'utf8');
        const webview = /function storedStatusOf\(id\) \{([\s\S]*?)\n\}/.exec(read('webview', 'board.js'))?.[1] ?? '';
        const schema = /export const StatusTokenSchema = (.*);/.exec(read('types.ts'))?.[1] ?? '';
        const webviewPattern = /(\/\^\[[^/]+\$\/i)\.test/.exec(webview)?.[1];
        const schemaPattern = /\.regex\((\/\^\[[^/]+\$\/i)\)/.exec(schema)?.[1];
        assert.ok(webviewPattern);
        assert.strictEqual(webviewPattern, schemaPattern);
        assert.match(webview, /status\.length <= 64/);
        assert.match(schema, /\.max\(64\)/);
    });
});
