import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import type * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';
import { sanitizeErrorWithContext } from '../../sanitizeError';
import { BdCommandError, capabilitiesFor, isClaimHeldByOther, parseBdVersion } from '../../shared/node';
import { IssueRefSchema } from '../../types';
import { RecordedFailure, loadFixture } from '../shared/bdFixtures';

suite('Claim leases: bd arguments', () => {
    let calls: string[][];
    let reclaimResult: unknown;

    function adapterFor(version: string): DaemonBeadsAdapter {
        const adapter = new DaemonBeadsAdapter('/unused', { appendLine: () => undefined } as unknown as vscode.OutputChannel);
        (adapter as any).ensureStoreReady = async () => capabilitiesFor(parseBdVersion(version));
        (adapter as any).execBd = async (args: string[]) => { calls.push(args); return args[0] === 'reclaim' ? reclaimResult : null; };
        return adapter;
    }

    setup(() => { calls = []; reclaimResult = { count: 2, reclaimed: [] }; });

    test('claim, release and heartbeat run the plain bd 1.3 commands, never --force', async () => {
        const adapter = adapterFor('1.3.1');
        await adapter.claimIssue('fx-a1');
        await adapter.unclaimIssue('fx-a1');
        await adapter.heartbeatIssue('fx-a1');
        assert.deepStrictEqual(calls, [['update', '--claim', '--', 'fx-a1'], ['unclaim', '--', 'fx-a1'], ['heartbeat', '--', 'fx-a1']]);
    });

    test('bd 1.2.2 is refused before anything runs', async () => {
        const adapter = adapterFor('1.2.2');
        await assert.rejects(adapter.claimIssue('fx-a1'), /Failed to claim issue: Claim leases need bd 1\.3\.0 or later/);
        await assert.rejects(adapter.reclaimStaleClaims('30m'), /need bd 1\.3\.0 or later/);
        assert.deepStrictEqual(calls, []);
    });

    test('an invalid id is refused before anything runs', async () => {
        await assert.rejects(adapterFor('1.3.1').heartbeatIssue('--help'), /cannot start with hyphen/);
        assert.deepStrictEqual(calls, []);
    });

    test('reclaim passes the chosen window and returns bd\'s count', async () => {
        assert.strictEqual(await adapterFor('1.3.1').reclaimStaleClaims('4h'), 2);
        assert.deepStrictEqual(calls, [['reclaim', '--older-than', '4h', '--json']]);
        reclaimResult = null;
        assert.strictEqual(await adapterFor('1.3.1').reclaimStaleClaims('30m'), 0);
    });

    test('reclaim refuses any window that is not minutes or hours', async () => {
        for (const window of ['30', '1d', '--force', '30m --any-replica', '']) {
            await assert.rejects(adapterFor('1.3.1').reclaimStaleClaims(window), /Invalid reclaim window/, window);
        }
        assert.deepStrictEqual(calls, []);
    });
});

suite('Claim leases: messages and refusals', () => {
    test('lease messages carry only a valid issue id', () => {
        assert.ok(IssueRefSchema.safeParse({ id: 'fx-a1' }).success);
        assert.ok(!IssueRefSchema.safeParse({ id: '--help' }).success);
        assert.ok(!IssueRefSchema.safeParse({}).success);
    });

    test('another actor\'s claim is reported without bd\'s --force advice', () => {
        const recorded = loadFixture<RecordedFailure>('1.3.1', 'unclaim-not-holder.json');
        const refusal = new BdCommandError(`bd command failed with exit code ${recorded.exitCode}`, {
            exitCode: recorded.exitCode, stderr: recorded.stderr, stdout: '', args: recorded.args
        });
        assert.ok(isClaimHeldByOther(refusal));
        const message = sanitizeErrorWithContext(new Error('Failed to release claim', { cause: refusal }));
        assert.match(message, /^Someone else holds the claim on this issue/);
        assert.doesNotMatch(message, /--force/);
        // Claim and heartbeat refusals as bd 1.3.1 printed them in a scratch store.
        for (const stderr of [
            'Error updating fx-cnl: issue already claimed by fixture-actor',
            'Error: heartbeat fx-cnl: issue already claimed by fixture-actor'
        ]) {
            assert.ok(isClaimHeldByOther(new BdCommandError('bd command failed with exit code 1', { exitCode: 1, stderr, stdout: '', args: [] })), stderr);
        }
        assert.ok(!isClaimHeldByOther(new BdCommandError('x', { exitCode: 1, stderr: 'issue not found', stdout: '', args: [] })));
    });

    test('the reclaim command is contributed and registered', async () => {
        const manifest = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'package.json'), 'utf8'));
        assert.ok(manifest.contributes.commands.some((c: { command: string }) => c.command === 'beadsKanban.reclaimStaleClaims'));
        const vscodeApi = await import('vscode');
        assert.ok((await vscodeApi.commands.getCommands(true)).includes('beadsKanban.reclaimStaleClaims'));
    });
});

suite('Claim leases: wiring that unit tests cannot reach', () => {
    const read = (...parts: string[]) => fs.readFileSync(path.resolve(__dirname, '..', '..', '..', ...parts), 'utf8');

    test('the lease message handlers sit after the read-only gate', () => {
        const extensionTs = read('src', 'extension.ts');
        const gate = extensionTs.indexOf('if (readOnly) {\n        post({ type: "mutation.error", requestId: msg.requestId, error: "Extension is in read-only mode." });');
        const handler = extensionTs.indexOf('msg.type === "issue.claim" || msg.type === "issue.unclaim" || msg.type === "issue.heartbeat"');
        assert.ok(gate > 0 && handler > gate, `gate ${gate}, handler ${handler}`);
    });

    test('the reclaim command checks read-only mode and bd support before asking anything', () => {
        const extensionTs = read('src', 'extension.ts');
        const command = extensionTs.slice(extensionTs.indexOf('"beadsKanban.reclaimStaleClaims", async () => {'));
        const quickPick = command.indexOf('showQuickPick');
        assert.ok(command.indexOf('"beadsKanban.readOnly"') > 0 && command.indexOf('"beadsKanban.readOnly"') < quickPick);
        assert.ok(command.indexOf('.leases') > 0 && command.indexOf('.leases') < quickPick);
    });

    test('the expired lease style comes after the assignee style it overrides', () => {
        const css = read('media', 'styles.css');
        const base = css.indexOf('.badge-assignee {');
        const expired = css.indexOf('.badge-assignee.badge-lease-expired {');
        assert.ok(base > 0 && expired > base, `base ${base}, expired ${expired}`);
    });
});
