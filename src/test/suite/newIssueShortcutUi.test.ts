import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { FocusReadyMessageSchema, FocusReportMessageSchema } from '../../newIssueShortcut';
import { buildFocusReadyMessage, buildFocusReportMessage, installNewIssueShortcut, ShortcutUiState } from '../../webview/newIssueShortcut';

const generation = '00000000-0000-4000-8000-000000000001';
const nextGeneration = '00000000-0000-4000-8000-000000000002';
type Listener = (event: { data?: unknown }) => void;

class Events {
    listeners = new Map<string, Set<Listener>>();
    addEventListener(type: string, listener: Listener) {
        if (!this.listeners.has(type)) { this.listeners.set(type, new Set()); }
        this.listeners.get(type)!.add(listener);
    }
    removeEventListener(type: string, listener: Listener) { this.listeners.get(type)?.delete(listener); }
    emit(type: string, data?: unknown) {
        for (const listener of [...(this.listeners.get(type) ?? [])]) { listener({ data }); }
    }
    count(type: string) { return this.listeners.get(type)?.size ?? 0; }
}

function harness(onSend?: (message: any, window: Events, document: Events) => void) {
    const window = new Events();
    const document = new Events();
    const state: ShortcutUiState = {
        focused: true, visible: true, initialized: true, readOnly: false, typing: false, modalOpen: false
    };
    const messages: any[] = [];
    let creations = 0;
    let ids = 0;
    const dispose = installNewIssueShortcut({
        window, document, state: () => state, requestId: () => `ui-${++ids}`,
        send: message => {
            messages.push(message);
            onSend?.(message, window, document);
        },
        newIssue: () => { creations++; state.modalOpen = true; }
    });
    const request = (value = generation) => window.emit('message', { type: 'ui.focus.request', payload: { generation: value } });
    const chord = () => window.emit('message', { type: 'ui.newIssue' });
    const reports = () => messages.filter(message => message.type === 'ui.focus');
    return { window, document, state, messages, dispose, request, chord, reports, creations: () => creations };
}

suite('New Issue shortcut UI', () => {
    test('actual builders satisfy the host strict schemas with exact envelope keys', () => {
        const ready = buildFocusReadyMessage('ready-id');
        assert.deepStrictEqual(FocusReadyMessageSchema.parse(ready), ready);
        assert.deepStrictEqual(Object.keys(ready).sort(), ['requestId', 'type']);
        assert.strictEqual(Object.hasOwn(ready, 'payload'), false);
        const focus = buildFocusReportMessage('focus-id', generation, 0, true);
        assert.deepStrictEqual(FocusReportMessageSchema.parse(focus), focus);
        assert.deepStrictEqual(Object.keys(focus).sort(), ['payload', 'requestId', 'type']);
        assert.deepStrictEqual(Object.keys(focus.payload).sort(), ['focused', 'generation', 'sequence']);
    });

    test('startup sends one ready only after all message and focus listeners are installed', () => {
        const h = harness((message, window, document) => {
            if (message.type !== 'ui.focus.ready') { return; }
            for (const type of ['message', 'focus', 'blur', 'pagehide']) { assert.strictEqual(window.count(type), 1, type); }
            assert.strictEqual(document.count('visibilitychange'), 1);
            window.emit('message', { type: 'ui.focus.request', payload: { generation } });
        });
        assert.deepStrictEqual(h.messages, [buildFocusReadyMessage('ui-1'), buildFocusReportMessage('ui-2', generation, 0, true)]);
        h.dispose();
    });

    test('focus changes before synchronization send no reports', () => {
        const h = harness();
        h.window.emit('focus'); h.window.emit('blur'); h.document.emit('visibilitychange');
        assert.strictEqual(h.messages.length, 1);
        h.dispose();
    });

    test('forced unchanged resync reports current focus and fresh generation', () => {
        const h = harness();
        h.request(); h.request(nextGeneration); h.request(nextGeneration);
        assert.deepStrictEqual(h.reports(), [
            buildFocusReportMessage('ui-2', generation, 0, true),
            buildFocusReportMessage('ui-3', nextGeneration, 0, true),
            buildFocusReportMessage('ui-4', nextGeneration, 1, true)
        ]);
        h.dispose();
    });

    test('focus blur and visibility changes deduplicate booleans with increasing sequences', () => {
        const h = harness();
        h.request(); h.window.emit('focus');
        h.state.focused = false; h.window.emit('blur'); h.window.emit('blur');
        h.state.focused = true; h.window.emit('focus');
        h.state.visible = false; h.document.emit('visibilitychange'); h.window.emit('focus');
        h.state.visible = true; h.document.emit('visibilitychange');
        const reports = h.reports();
        assert.deepStrictEqual(reports.map(message => message.payload.focused), [true, false, true, false, true]);
        assert.deepStrictEqual(reports.map(message => message.payload.sequence), [0, 1, 2, 3, 4]);
        assert.strictEqual(new Set(h.messages.map(message => message.requestId)).size, h.messages.length);
        for (const report of reports) { assert.deepStrictEqual(FocusReportMessageSchema.parse(report), report); }
        h.dispose();
    });

    test('resync reports false for hidden or unfocused documents without changing permissions', () => {
        for (const field of ['focused', 'visible'] as const) {
            const h = harness();
            h.state[field] = false;
            const before = { ...h.state };
            h.request(); h.request(nextGeneration);
            assert.deepStrictEqual(h.reports().map(message => message.payload.focused), [false, false]);
            assert.deepStrictEqual(h.state, before);
            h.dispose();
        }
    });

    test('pagehide reports false then removes owned listeners and stops reporting and actions', () => {
        const h = harness();
        h.request();
        h.window.emit('pagehide');
        assert.deepStrictEqual(h.reports().map(message => message.payload.focused), [true, false]);
        const count = h.messages.length;
        h.window.emit('focus'); h.request(); h.chord(); h.document.emit('visibilitychange');
        assert.strictEqual(h.messages.length, count);
        assert.strictEqual(h.creations(), 0);
        for (const type of ['message', 'focus', 'blur', 'pagehide']) { assert.strictEqual(h.window.count(type), 0, type); }
        assert.strictEqual(h.document.count('visibilitychange'), 0);
        h.dispose();
    });

    test('cleanup removes only owned listeners and ignores queued callbacks after disposal', () => {
        const h = harness();
        let unrelated = 0;
        h.window.addEventListener('focus', () => unrelated++);
        const queuedMessage = [...h.window.listeners.get('message')!][0];
        const queuedFocus = [...h.window.listeners.get('focus')!][0];
        h.request();
        h.window.emit('message', { type: 'webview.cleanup' });
        const count = h.messages.length;
        queuedMessage({ data: { type: 'ui.newIssue' } });
        queuedMessage({ data: { type: 'ui.focus.request', payload: { generation: nextGeneration } } });
        h.state.focused = false; queuedFocus({});
        h.window.emit('focus'); h.window.emit('blur'); h.window.emit('pagehide'); h.document.emit('visibilitychange');
        assert.strictEqual(unrelated, 1);
        assert.strictEqual(h.window.count('focus'), 1);
        for (const type of ['message', 'blur', 'pagehide']) { assert.strictEqual(h.window.count(type), 0, type); }
        assert.strictEqual(h.document.count('visibilitychange'), 0);
        assert.strictEqual(h.messages.length, count);
        assert.strictEqual(h.creations(), 0);
        h.dispose();
    });

    test('a new document starts with ready and no inherited generation', () => {
        const old = harness(); old.request(); old.dispose();
        const fresh = harness(); fresh.window.emit('focus');
        assert.deepStrictEqual(fresh.messages, [buildFocusReadyMessage('ui-1')]);
        fresh.request(nextGeneration);
        assert.deepStrictEqual(fresh.reports(), [buildFocusReportMessage('ui-2', nextGeneration, 0, true)]);
        fresh.dispose();
    });

    for (const [name, change] of [
        ['document-focus', { focused: false }],
        ['visibility', { visible: false }],
        ['initialization', { initialized: false }],
        ['read-only', { readOnly: true }],
        ['input', { typing: true }],
        ['modal', { modalOpen: true }]
    ] as const) {
        test(`${name} guard consumes without action or state changes`, () => {
            const h = harness(); Object.assign(h.state, change);
            const before = { ...h.state };
            h.chord();
            assert.strictEqual(h.creations(), 0);
            assert.deepStrictEqual(h.state, before);
            assert.deepStrictEqual(h.messages, [buildFocusReadyMessage('ui-1')]);
            h.dispose();
        });
    }

    test('writable focused initialized board invokes the shared action once and repeated chords preserve its modal', () => {
        const h = harness();
        h.chord(); h.chord();
        assert.strictEqual(h.creations(), 1);
        assert.strictEqual(h.state.modalOpen, true);
        h.dispose();
    });

    test('malformed and unknown host envelopes cannot create resync dispose or change state', () => {
        const h = harness();
        h.request();
        const before = { ...h.state };
        for (const message of [
            null, 1, 'ui.newIssue', {}, { type: 'unknown' },
            { type: 'ui.newIssue', payload: {} }, { type: 'ui.newIssue', requestId: 'extra' },
            { type: 'ui.focus.request' }, { type: 'ui.focus.request', payload: { generation: 'invalid' } },
            { type: 'ui.focus.request', payload: { generation: nextGeneration, extra: true } },
            { type: 'ui.focus.request', payload: { generation: nextGeneration }, requestId: 'extra' },
            { type: 'webview.cleanup', payload: {} }
        ]) { h.window.emit('message', message); }
        assert.strictEqual(h.creations(), 0);
        assert.strictEqual(h.messages.length, 2);
        assert.deepStrictEqual(h.state, before);
        h.state.focused = false; h.window.emit('blur');
        assert.deepStrictEqual(h.reports()[1], buildFocusReportMessage('ui-3', generation, 1, false));
        h.dispose();
    });

    test('production wiring reads live DOM guards uses direct transport and the shared New action', () => {
        const board = fs.readFileSync(path.resolve(__dirname, '../../../src/webview/board.js'), 'utf8');
        const wiring = board.slice(board.lastIndexOf('installNewIssueShortcut({'));
        assert.match(wiring, /focused: document\.hasFocus\(\)/);
        assert.match(wiring, /visible: document\.visibilityState === 'visible'/);
        assert.match(wiring, /initialized: creationPermissionsInitialized,\s*readOnly,/);
        assert.match(wiring, /document\.activeElement\?\.tagName === 'INPUT'/);
        assert.match(wiring, /document\.activeElement\?\.tagName === 'TEXTAREA'/);
        assert.match(wiring, /document\.activeElement\?\.isContentEditable === true/);
        assert.match(wiring, /modalOpen: !!document\.querySelector\('dialog\[open\], \[aria-modal="true"\]'\)/);
        assert.match(wiring, /send: message => vscode\.postMessage\(message\)/);
        assert.match(wiring, /newIssue: \(\) => newBtn\.click\(\)/);
        assert.ok(board.indexOf('window.addEventListener("message"') < board.lastIndexOf('installNewIssueShortcut({'));
        assert.match(board, /let creationPermissionsInitialized = false;/);
        for (const type of ['board.data', 'board.minimal']) {
            const handler = board.slice(board.indexOf(`if (msg.type === "${type}")`));
            assert.match(handler.slice(0, handler.indexOf('return;\n    }')), /creationPermissionsInitialized = typeof msg\.payload\.readOnly === 'boolean';/);
        }
        assert.match(board, /newBtn\.addEventListener\("click",[\s\S]*?openDetail\(emptyCard\);/);
        const keyboard = board.slice(board.indexOf('document.addEventListener("keydown"'), board.indexOf('window.addEventListener("message"'));
        assert.doesNotMatch(keyboard, /toLowerCase\(\) === 'n'/);
        for (const key of ['r', 'f']) { assert.ok(keyboard.includes(`e.key.toLowerCase() === '${key}'`)); }
        assert.match(keyboard, /e\.key === 'Escape'[\s\S]*?requestDetailClose\(\)/);
    });

    test('production browser helper has no host Node or vscode imports or persistence', () => {
        const helper = fs.readFileSync(path.resolve(__dirname, '../../../src/webview/newIssueShortcut.ts'), 'utf8');
        const imports = helper.match(/^import .* from .*;$/gm);
        assert.deepStrictEqual(imports, ["import { z } from 'zod';"]);
        assert.doesNotMatch(helper, /setState|localStorage|setInterval|setTimeout|pendingRequests/);
    });
});
