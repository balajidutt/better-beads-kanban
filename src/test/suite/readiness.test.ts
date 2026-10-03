import * as assert from 'assert';
import * as sinon from 'sinon';
import * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';
import { RECORDED_BD_VERSIONS, SeededIds, loadFixture } from '../shared/bdFixtures';

for (const version of RECORDED_BD_VERSIONS) {
    suite(`Readiness from bd ready (recorded bd ${version})`, () => {
        const ids = loadFixture<SeededIds>(version, 'ids.json');
        const recordedReady = () => loadFixture<Array<{ id: string }>>(version, 'ready.json');
        let calls: string[][];
        let logs: string[];
        let ready: () => unknown;
        let showWarning: sinon.SinonStub;

        function makeAdapter(): DaemonBeadsAdapter {
            const adapter = new DaemonBeadsAdapter('/unused', { appendLine: (line: string) => logs.push(line) } as unknown as vscode.OutputChannel);
            (adapter as any).ensureStoreReady = async () => undefined;
            (adapter as any).execBd = async (args: string[]) => {
                calls.push(args);
                if (args[0] === 'list') { return loadFixture(version, 'list-all.json'); }
                if (args[0] === 'ready') { return ready(); }
                if (args[0] === 'show') {
                    return loadFixture<Array<{ id: string }>>(version, 'show-full.json').filter(i => i.id === args[args.length - 1]);
                }
                return null;
            };
            return adapter;
        }

        setup(() => {
            calls = [];
            logs = [];
            ready = recordedReady;
            showWarning = sinon.stub(vscode.window, 'showWarningMessage').resolves(undefined);
        });

        teardown(() => { sinon.restore(); });

        test('only the issues bd ready lists are ready; the blocked issue is not', async () => {
            const cards = await makeAdapter().getBoardMinimal();
            const readyCards = cards.filter(card => card.is_ready).map(card => card.id).sort();
            assert.deepStrictEqual(readyCards, [ids.blocker, ids.child, ids.parent].sort());
            assert.strictEqual(cards.find(card => card.id === ids.blocked)?.is_ready, false);
        });

        test('bd ready runs before bd list, so a deferred issue it wakes is listed as open', async () => {
            await makeAdapter().getBoardMinimal();
            assert.deepStrictEqual(calls.map(call => call[0]), ['ready', 'list']);
            assert.deepStrictEqual(calls[0], ['ready', '--json', '--limit', '0']);
        });

        test('the detail view takes readiness from the same bd ready result as the board', async () => {
            ready = () => recordedReady().filter(issue => issue.id !== ids.blocker);
            const adapter = makeAdapter();
            await adapter.getBoardMinimal();
            assert.strictEqual((await adapter.getIssueFull(ids.blocker)).is_ready, false);
            assert.strictEqual((await adapter.getIssueFull(ids.parent)).is_ready, true);
        });

        test('an issue bd ready lists is still not ready unless it is open', async () => {
            ready = () => [...recordedReady(), { id: ids.claimed }];
            const adapter = makeAdapter();
            const cards = await adapter.getBoardMinimal();
            assert.strictEqual(cards.find(card => card.id === ids.claimed)?.is_ready, false);
            assert.strictEqual((await adapter.getIssueFull(ids.claimed)).is_ready, false);
        });

        test('a failed bd ready still loads the board, warns once and stops overriding detail readiness', async () => {
            ready = () => recordedReady().filter(issue => issue.id !== ids.blocker);
            const adapter = makeAdapter();
            await adapter.getBoardMinimal();
            ready = () => { throw new Error('bd ready failed'); };
            const cards = await adapter.getBoardMinimal();
            await adapter.getBoardMinimal();
            assert.strictEqual(cards.length, Object.keys(ids).length);
            assert.ok(logs.some(line => line.includes('bd ready failed; readiness falls back to list data')));
            assert.ok(showWarning.calledOnce);
            assert.strictEqual((await adapter.getIssueFull(ids.blocker)).is_ready, true);
        });
    });
}
