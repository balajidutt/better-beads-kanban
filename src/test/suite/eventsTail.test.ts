import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { EventEmitter } from 'events';
import { PassThrough } from 'stream';
import * as sinon from 'sinon';
import type * as vscode from 'vscode';
import { DaemonBeadsAdapter } from '../../daemonBeadsAdapter';
import { EventsTail, HEALTHY_RUN_MS, KILL_GRACE_MS, MAX_CHILD_LIFETIME_MS, MAX_EVENT_LINE_CHARS, affectsEventsFeed } from '../../eventsTail';
import { BeadsEvent, EventsTruncation, capabilitiesFor, parseBdVersion } from '../../shared/node';

type FakeChild = EventEmitter & { stdout: PassThrough; stderr: PassThrough; kill: sinon.SinonSpy; exitCode: number | null; signalCode: string | null };

suite('Events journal feed process', () => {
    let clock: sinon.SinonFakeTimers;
    let children: FakeChild[];
    let spawnArgs: string[][];
    let spawnOptions: Array<Record<string, unknown>>;
    let batches: BeadsEvent[][];
    let events: BeadsEvent[];
    let truncations: EventsTruncation[];
    let logs: string[];

    const spawn = ((_executable: string, args: string[], options: Record<string, unknown>) => {
        spawnArgs.push(args);
        spawnOptions.push(options);
        const child = Object.assign(new EventEmitter(), {
            stdout: new PassThrough(), stderr: new PassThrough(), kill: sinon.spy(), exitCode: null, signalCode: null
        });
        children.push(child);
        return child;
    }) as any;

    function makeTail(since = 0): EventsTail {
        return new EventsTail({
            executable: 'bd', cwd: '/repo', since, spawn,
            onEvents: batch => { batches.push(batch); events.push(...batch); },
            onTruncated: truncation => truncations.push(truncation),
            log: message => logs.push(message)
        });
    }
    const line = (seq: number, op = 'update') => `${JSON.stringify({ seq, op, issue_id: `fx-${seq}`, issue: {} })}\n`;

    setup(() => {
        clock = sinon.useFakeTimers();
        children = []; spawnArgs = []; spawnOptions = []; batches = []; events = []; truncations = []; logs = [];
    });
    teardown(() => { clock.restore(); });

    test('follows from the checkpoint with flag-first arguments, no shell and a scrubbed environment', () => {
        const saved = process.env.BD_JSON_ENVELOPE;
        process.env.BD_JSON_ENVELOPE = '1';
        try {
            makeTail(41).start();
        } finally {
            if (saved === undefined) { delete process.env.BD_JSON_ENVELOPE; } else { process.env.BD_JSON_ENVELOPE = saved; }
        }
        assert.deepStrictEqual(spawnArgs, [['events', 'tail', '--since', '41', '--follow', '--json']]);
        assert.strictEqual(spawnOptions[0].shell, false);
        assert.strictEqual(spawnOptions[0].cwd, '/repo');
        assert.strictEqual((spawnOptions[0].env as NodeJS.ProcessEnv).BD_JSON_ENVELOPE, undefined);
        assert.deepStrictEqual(spawnOptions[0].stdio, ['ignore', 'pipe', 'pipe']);
    });

    test('a replayed burst arrives as one batch per chunk', () => {
        makeTail().start();
        children[0].stdout.emit('data', line(1) + line(2) + line(3));
        children[0].stdout.emit('data', line(4));
        assert.deepStrictEqual(batches.map(batch => batch.map(e => e.seq)), [[1, 2, 3], [4]]);
    });

    test('delivers records split across chunks, in order, and skips seqs already seen', () => {
        const tail = makeTail(1);
        tail.start();
        const chunk = line(1) + line(2) + line(3);
        children[0].stdout.emit('data', chunk.slice(0, 20));
        children[0].stdout.emit('data', chunk.slice(20));
        assert.deepStrictEqual(events.map(e => e.seq), [2, 3]);
        assert.strictEqual(tail.lastSeq, 3);
    });

    test('an over-long line is dropped, the buffer stays bounded and the rest of that line is skipped', () => {
        const tail = makeTail();
        tail.start();
        children[0].stdout.emit('data', 'x'.repeat(MAX_EVENT_LINE_CHARS + 1));
        assert.strictEqual(tail.bufferedChars, 0);
        children[0].stdout.emit('data', `${line(4).trim()}\n${line(5)}`);
        assert.ok(tail.bufferedChars <= MAX_EVENT_LINE_CHARS);
        assert.deepStrictEqual(events.map(e => e.seq), [5]);
        assert.ok(logs.some(message => message.includes('dropped')));
    });

    test('an exited child restarts from the last seq with growing backoff', () => {
        makeTail().start();
        children[0].stdout.emit('data', line(7));
        children[0].emit('close', 1);
        assert.strictEqual(children.length, 1);
        clock.tick(1000);
        assert.deepStrictEqual(spawnArgs[1], ['events', 'tail', '--since', '7', '--follow', '--json']);
        children[1].emit('close', 1);
        clock.tick(1999);
        assert.strictEqual(children.length, 2);
        clock.tick(1);
        assert.strictEqual(children.length, 3);
    });

    test('backoff stops growing at one minute', () => {
        makeTail().start();
        for (let i = 0; i < 8; i++) {
            children[children.length - 1].emit('close', 1);
            clock.tick(60000);
        }
        const before = children.length;
        children[children.length - 1].emit('close', 1);
        clock.tick(59999);
        assert.strictEqual(children.length, before);
        clock.tick(1);
        assert.strictEqual(children.length, before + 1);
    });

    test('a child that ran healthily restarts after the shortest backoff again', () => {
        makeTail().start();
        children[0].emit('close', 1);
        clock.tick(1000);
        children[1].emit('close', 1);
        clock.tick(2000);
        assert.strictEqual(children.length, 3);
        clock.tick(HEALTHY_RUN_MS);
        children[2].emit('close', 1);
        clock.tick(999);
        assert.strictEqual(children.length, 3);
        clock.tick(1);
        assert.strictEqual(children.length, 4);
    });

    test('the follower is recycled after its maximum lifetime and resumes from the last seq', () => {
        makeTail().start();
        children[0].stdout.emit('data', line(12));
        clock.tick(MAX_CHILD_LIFETIME_MS);
        assert.ok(children[0].kill.calledWith('SIGTERM'));
        assert.deepStrictEqual(spawnArgs[1], ['events', 'tail', '--since', '12', '--follow', '--json']);
        children[0].emit('close', null);
        clock.tick(60000);
        assert.strictEqual(children.length, 2);
    });

    test('a child that ignores SIGTERM is killed after the grace period', () => {
        const tail = makeTail();
        tail.start();
        tail.dispose();
        assert.ok(children[0].kill.calledWith('SIGTERM'));
        assert.ok(!children[0].kill.calledWith('SIGKILL'));
        clock.tick(KILL_GRACE_MS);
        assert.ok(children[0].kill.calledWith('SIGKILL'));
    });

    test('a compact one-line truncation is reported once', () => {
        makeTail().start();
        children[0].stdout.emit('data', '{"code":"events_journal_truncated","floor":3,"head":9,"since":0}\n');
        children[0].emit('close', 1);
        assert.deepStrictEqual(truncations, [{ floor: 3, head: 9 }]);
    });

    test('a truncated checkpoint resumes at head and reports it', () => {
        const tail = makeTail(0);
        tail.start();
        // bd prints the refusal as pretty-printed JSON, as recorded from bd 1.3.1.
        const body = JSON.stringify({ code: 'events_journal_truncated', error: 'pruned', floor: 40, head: 52, schema_version: 1, since: 0 }, null, 2);
        children[0].stdout.emit('data', `${body.slice(0, 30)}`);
        children[0].stdout.emit('data', `${body.slice(30)}\n`);
        children[0].emit('close', 1);
        assert.deepStrictEqual(truncations, [{ floor: 40, head: 52 }]);
        assert.strictEqual(tail.lastSeq, 52);
        clock.tick(1000);
        assert.deepStrictEqual(spawnArgs[1], ['events', 'tail', '--since', '52', '--follow', '--json']);
    });

    test('dispose kills the child and nothing restarts or reports afterwards', () => {
        const tail = makeTail();
        tail.start();
        tail.dispose();
        assert.ok(children[0].kill.calledWith('SIGTERM'));
        children[0].stdout.emit('data', line(9));
        children[0].emit('close', 0);
        clock.tick(120000);
        assert.strictEqual(children.length, 1);
        assert.deepStrictEqual(events, []);
    });
});

suite('Events journal detection', () => {
    function adapterFor(version: string, value: unknown): { adapter: DaemonBeadsAdapter; calls: string[][] } {
        const calls: string[][] = [];
        const adapter = new DaemonBeadsAdapter('/unused', { appendLine: () => undefined } as unknown as vscode.OutputChannel);
        (adapter as any).ensureStoreReady = async () => capabilitiesFor(parseBdVersion(version));
        (adapter as any).execBd = async (args: string[]) => { calls.push(args); return value; };
        return { adapter, calls };
    }

    test('enabled only on bd 1.3 with events-journal set to true', async () => {
        const on = adapterFor('1.3.1', { key: 'events-journal', value: 'true' });
        assert.strictEqual(await on.adapter.isEventsJournalEnabled(), true);
        assert.deepStrictEqual(on.calls, [['config', 'get', 'events-journal', '--json']]);
        assert.strictEqual(await adapterFor('1.3.1', { key: 'events-journal', value: 'false' }).adapter.isEventsJournalEnabled(), false);
        assert.strictEqual(await adapterFor('1.3.1', { key: 'events-journal', value: true }).adapter.isEventsJournalEnabled(), true);
        const old = adapterFor('1.2.2', { value: 'true' });
        assert.strictEqual(await old.adapter.isEventsJournalEnabled(), false);
        assert.deepStrictEqual(old.calls, []);
    });
});

suite('Events journal feed restarts', () => {
    const changed = (...sections: string[]) => ({ affectsConfiguration: (section: string) => sections.includes(section) });

    test('a change to the journal toggle or the bd path restarts the feed, other settings do not', () => {
        assert.strictEqual(affectsEventsFeed(changed('beadsKanban.useEventsJournal')), true);
        assert.strictEqual(affectsEventsFeed(changed('beadsKanban.bdPath')), true);
        assert.strictEqual(affectsEventsFeed(changed('beadsKanban.initialLoadLimit', 'beadsKanban.readOnly')), false);
    });

    test('the board\'s settings listener restarts the feed through that check', () => {
        const extensionTs = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'src', 'extension.ts'), 'utf8');
        assert.match(extensionTs, /if \(affectsEventsFeed\(event\)\) \{\s*void startEventsFeed\(/);
    });
});

suite('Events journal refreshes and the board\'s own writes', () => {
    test('only the board\'s own recent mutations suppress a journal refresh', () => {
        const clock = sinon.useFakeTimers(1_000_000);
        try {
            const adapter = new DaemonBeadsAdapter('/unused', { appendLine: () => undefined } as unknown as vscode.OutputChannel);
            assert.strictEqual(adapter.isRecentSelfMutation(), false);
            (adapter as any).trackInteraction();
            assert.strictEqual(adapter.isRecentSelfMutation(), false);
            assert.strictEqual(adapter.isRecentSelfSave(), true);
            (adapter as any).trackMutation();
            assert.strictEqual(adapter.isRecentSelfMutation(), true);
            clock.tick(2000);
            assert.strictEqual(adapter.isRecentSelfMutation(), false);
        } finally {
            clock.restore();
        }
    });

    test('journal events use the mutation window and file changes the interaction window', () => {
        const extensionTs = fs.readFileSync(path.resolve(__dirname, '..', '..', '..', 'src', 'extension.ts'), 'utf8');
        assert.match(extensionTs, /fromEvent \? adapter\.isRecentSelfMutation\(\) : adapter\.isRecentSelfSave\(\)/);
        assert.match(extensionTs, /requestRefresh\(true\)/);
    });
});
