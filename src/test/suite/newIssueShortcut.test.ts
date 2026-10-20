import * as assert from 'assert';
import * as fs from 'fs';
import * as path from 'path';
import { randomUUID } from 'crypto';
import { FocusReadyMessageSchema, FocusReportMessageSchema, NewIssueShortcutController, ShortcutHostMessage } from '../../newIssueShortcut';
import { sanitizeError } from '../../sanitizeError';

const root = path.resolve(__dirname, '../../..');
const ready = { type: 'ui.focus.ready', requestId: 'ready-1' };
const flush = () => new Promise<void>(resolve => setImmediate(resolve));

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}

class Panel {
  active = true;
  visible = true;
  messages: ShortcutHostMessage[] = [];
  send: (message: ShortcutHostMessage) => PromiseLike<boolean> = () => Promise.resolve(true);
  webview = { postMessage: (message: ShortcutHostMessage) => {
    this.messages.push(message);
    return this.send(message);
  } };
  generation(): string {
    const requests = this.messages.filter(message => message.type === 'ui.focus.request');
    const request = requests[requests.length - 1];
    assert.ok(request && request.type === 'ui.focus.request');
    assert.deepStrictEqual(Object.keys(request).sort(), ['payload', 'type']);
    assert.deepStrictEqual(Object.keys(request.payload), ['generation']);
    return request.payload.generation;
  }
  creations() { return this.messages.filter(message => message.type === 'ui.newIssue'); }
}

function harness(publish?: (value: boolean) => PromiseLike<unknown>) {
  const live = new Set<Panel>();
  const contexts: boolean[] = [];
  const logs: string[] = [];
  const controller = new NewIssueShortcutController({
    livePanels: live, windowFocused: true, generation: randomUUID,
    publishContext: value => { contexts.push(value); return publish ? publish(value) : Promise.resolve(); },
    log: message => logs.push(message), sanitizeError, now: () => '2026-10-18T12:00:00.000Z'
  });
  const attach = (panel = new Panel()) => { live.add(panel); controller.attach(panel); return panel; };
  const report = (panel: Panel, focused: boolean, sequence = 0, generation = panel.generation()) => {
    controller.handleMessage(panel, { type: 'ui.focus', requestId: 'focus-1', payload: { generation, sequence, focused } });
  };
  const qualify = (panel: Panel) => { controller.handleMessage(panel, ready); report(panel, true); };
  return { controller, live, contexts, logs, attach, report, qualify };
}

function assertHostWiring(source: string): void {
  const extension = source.replace(/\r\n/g, '\n');
  assert.ok(extension.includes("registerCommand('beadsKanban.newIssue', () => shortcut.newIssue())"), 'shortcut command registration');
  assert.ok(extension.includes('livePanels,\n    windowFocused: vscode.window.state.focused'), 'shared registry and current window focus');
  assert.ok(extension.includes('onDidChangeWindowState(state => shortcut.windowChanged(state.focused))'), 'window focus listener');
  assert.ok(extension.includes('panel.onDidChangeViewState(() => shortcut.panelChanged(panel))'), 'panel view listener');
  assert.ok(extension.includes('shortcut.detach(panel);'), 'panel shortcut detachment');
  const start = extension.indexOf('panel.webview.onDidReceiveMessage');
  const focus = extension.indexOf('if (shortcut.handleMessage(panel, msg)) { return; }', start);
  const logging = extension.indexOf('output.appendLine', start);
  const gate = extension.indexOf('if (readOnly)', start);
  assert.ok(start >= 0 && focus > start && focus < logging && focus < gate, 'focus handling before logging and read-only gate');
  assert.ok(extension.includes('| ShortcutHostMessage'), 'unsolicited host message union');
  assert.ok(extension.includes("executeCommand('setContext', 'beadsKanban.boardFocus', focused)"), 'board focus context publication');
}

function hostSourceWithLineEnding(ending: string): string {
  return fs.readFileSync(path.join(root, 'src/extension.ts'), 'utf8').replace(/\r\n/g, '\n').replace(/\n/g, ending);
}

suite('New Issue shortcut', () => {
  test('manifest scopes and hides the Ctrl/Cmd+N routing command', () => {
    const manifest = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
    const command = 'beadsKanban.newIssue';
    assert.ok(manifest.contributes.commands.some((entry: any) => entry.command === command));
    const bindings = manifest.contributes.keybindings.filter((entry: any) => entry.command === command);
    assert.deepStrictEqual(bindings, [{
      command, key: 'ctrl+n', mac: 'cmd+n',
      when: 'activeWebviewPanelId == beadsKanban.board && beadsKanban.boardFocus && !editorFocus && !terminalFocus && !panelFocus && !sideBarFocus && !auxiliaryBarFocus'
    }]);
    assert.deepStrictEqual(manifest.contributes.menus.commandPalette.filter((entry: any) => entry.command === command), [{ command, when: 'false' }]);
  });

  test('ready schema requires the exact envelope without a payload property', () => {
    assert.deepStrictEqual(FocusReadyMessageSchema.parse(ready), ready);
    for (const extra of [{ payload: undefined }, { payload: {} }, { focused: true }]) {
      const parsed = FocusReadyMessageSchema.safeParse({ ...ready, ...extra });
      assert.ok(!parsed.success);
      assert.ok(parsed.error.issues.some(issue => issue.code === 'unrecognized_keys'));
    }
  });

  test('schemas reject bad requestIds for the requestId constraint', () => {
    for (const requestId of [undefined, null, '', 12, 'x'.repeat(129)]) {
      for (const schema of [FocusReadyMessageSchema, FocusReportMessageSchema]) {
        const parsed = schema.safeParse({
          type: schema === FocusReadyMessageSchema ? 'ui.focus.ready' : 'ui.focus', requestId,
          ...(schema === FocusReportMessageSchema ? { payload: { generation: randomUUID(), sequence: 0, focused: true } } : {})
        });
        assert.ok(!parsed.success);
        assert.ok(parsed.error.issues.some(issue => issue.path.join('.') === 'requestId'));
      }
    }
    assert.ok(FocusReadyMessageSchema.safeParse({ ...ready, requestId: 'x'.repeat(128) }).success);
  });

  test('focus schema accepts booleans and safe nonnegative integer sequences', () => {
    for (const focused of [false, true]) {
      for (const sequence of [0, 1, Number.MAX_SAFE_INTEGER]) {
        const message = { type: 'ui.focus', requestId: 'f', payload: { generation: randomUUID(), sequence, focused } };
        assert.deepStrictEqual(FocusReportMessageSchema.parse(message), message);
      }
    }
  });

  test('focus schema rejects each missing or malformed payload field for its own constraint', () => {
    const payload = { generation: randomUUID(), sequence: 0, focused: true };
    const cases: Array<[string, unknown]> = [
      ...[undefined, '', 'not-a-uuid', 1].map(value => ['generation', value] as [string, unknown]),
      ...[undefined, -1, 0.5, Number.MAX_SAFE_INTEGER + 1, Infinity, NaN, '1', true].map(value => ['sequence', value] as [string, unknown]),
      ...[undefined, null, 'true', 1, {}].map(value => ['focused', value] as [string, unknown])
    ];
    for (const [field, value] of cases) {
      const parsed = FocusReportMessageSchema.safeParse({ type: 'ui.focus', requestId: 'f', payload: { ...payload, [field]: value } });
      assert.ok(!parsed.success, `${field}=${String(value)}`);
      assert.ok(parsed.error.issues.some(issue => issue.path.join('.') === `payload.${field}`));
    }
    for (const field of ['generation', 'sequence', 'focused']) {
      const incomplete: any = { ...payload };
      delete incomplete[field];
      const parsed = FocusReportMessageSchema.safeParse({ type: 'ui.focus', requestId: 'f', payload: incomplete });
      assert.ok(!parsed.success);
      assert.ok(parsed.error.issues.some(issue => issue.path.join('.') === `payload.${field}`));
    }
  });

  test('focus schema strictness rejects extras at both levels', () => {
    const message = { type: 'ui.focus', requestId: 'f', payload: { generation: randomUUID(), sequence: 0, focused: true } };
    for (const input of [{ ...message, extra: 1 }, { ...message, payload: { ...message.payload, extra: 1 } }]) {
      const parsed = FocusReportMessageSchema.safeParse(input);
      assert.ok(!parsed.success);
      assert.ok(parsed.error.issues.some(issue => issue.code === 'unrecognized_keys'));
    }
    for (const input of [null, {}, { ...message, type: 'other' }, { ...message, payload: undefined }]) {
      assert.strictEqual(FocusReportMessageSchema.safeParse(input).success, false);
    }
  });

  test('activation and a fresh host unconditionally clear renderer stale true', async () => {
    let renderer = true;
    const h = harness(value => { renderer = value; return Promise.resolve(); });
    assert.deepStrictEqual(h.contexts, [false]);
    assert.strictEqual(renderer, false);
    await h.controller.newIssue();
    const panel = h.attach();
    h.qualify(panel);
    await flush();
    assert.strictEqual(renderer, true);
    const restart = harness(value => { renderer = value; return Promise.resolve(); });
    assert.deepStrictEqual(restart.contexts, [false]);
    assert.strictEqual(renderer, false);
    await restart.controller.newIssue();
    assert.deepStrictEqual(panel.creations(), []);
  });

  test('eligible focus routing sends one exact unsolicited message to only the focused panel', async () => {
    const h = harness();
    const hidden = h.attach();
    hidden.visible = false;
    const inactive = h.attach();
    inactive.active = false;
    const focused = h.attach();
    h.qualify(focused);
    await h.controller.newIssue();
    assert.deepStrictEqual(focused.creations(), [{ type: 'ui.newIssue' }]);
    assert.deepStrictEqual(hidden.creations(), []);
    assert.deepStrictEqual(inactive.creations(), []);
    h.report(focused, false, 1);
    await h.controller.newIssue();
    assert.strictEqual(focused.creations().length, 1);
  });

  test('untracked and not-ready panels cannot route or publish positive focus', async () => {
    const h = harness();
    const stranger = new Panel();
    h.controller.handleMessage(stranger, ready);
    const panel = h.attach();
    await h.controller.newIssue();
    assert.deepStrictEqual(panel.messages, []);
    assert.deepStrictEqual(stranger.messages, []);
    assert.deepStrictEqual(h.contexts, [false]);
  });

  test('validated focus updates eligibility synchronously before publication resolves', async () => {
    const pending = deferred<void>();
    const h = harness(value => value ? pending.promise : Promise.resolve());
    await flush();
    const panel = h.attach();
    h.qualify(panel);
    assert.deepStrictEqual(h.contexts, [false, true]);
    await h.controller.newIssue();
    assert.strictEqual(panel.creations().length, 1);
    h.report(panel, false, 1);
    await h.controller.newIssue();
    assert.strictEqual(panel.creations().length, 1);
    pending.resolve();
    await flush();
    assert.deepStrictEqual(h.contexts, [false, true, false]);
  });

  test('ready resync invalidates the old document generation and sequence regressions', async () => {
    const h = harness();
    const panel = h.attach();
    h.qualify(panel);
    const old = panel.generation();
    h.controller.handleMessage(panel, ready);
    const current = panel.generation();
    assert.notStrictEqual(current, old);
    h.report(panel, true, 100, old);
    await h.controller.newIssue();
    assert.deepStrictEqual(panel.creations(), []);
    h.report(panel, false, 4, current);
    h.report(panel, true, 4, current);
    h.report(panel, true, 3, current);
    await h.controller.newIssue();
    assert.deepStrictEqual(panel.creations(), []);
    h.report(panel, true, 5, current);
    await h.controller.newIssue();
    assert.strictEqual(panel.creations().length, 1);
  });

  test('per-panel generation ownership rejects copied reports and isolates late blur', async () => {
    const h = harness();
    const a = h.attach();
    const b = h.attach();
    h.controller.handleMessage(a, ready);
    h.controller.handleMessage(b, ready);
    h.report(b, true, 0, a.generation());
    await h.controller.newIssue();
    assert.deepStrictEqual(b.creations(), []);
    h.report(b, true, 1);
    h.report(a, false, 20);
    await h.controller.newIssue();
    assert.deepStrictEqual(a.creations(), []);
    assert.deepStrictEqual(b.creations(), [{ type: 'ui.newIssue' }]);
    await flush();
    assert.strictEqual(h.contexts[h.contexts.length - 1], true);
  });

  for (const property of ['active', 'visible'] as const) {
    test(`${property} lifecycle invalidation rejects hidden stale true through reshow`, async () => {
      const h = harness();
      const panel = h.attach();
      h.qualify(panel);
      const old = panel.generation();
      panel[property] = false;
      h.controller.panelChanged(panel);
      h.report(panel, true, 20, old);
      await h.controller.newIssue();
      assert.deepStrictEqual(panel.creations(), []);
      panel[property] = true;
      h.controller.panelChanged(panel);
      assert.notStrictEqual(panel.generation(), old);
      h.report(panel, true, 21, old);
      await h.controller.newIssue();
      assert.deepStrictEqual(panel.creations(), []);
      h.report(panel, true);
      await h.controller.newIssue();
      assert.strictEqual(panel.creations().length, 1);
    });
  }

  test('window blur invalidates every generation and reactivation requires a new report', async () => {
    const h = harness();
    const panel = h.attach();
    h.qualify(panel);
    const old = panel.generation();
    h.controller.windowChanged(false);
    h.report(panel, true, 10, old);
    await h.controller.newIssue();
    h.controller.windowChanged(true);
    h.report(panel, true, 11, old);
    await h.controller.newIssue();
    assert.deepStrictEqual(panel.creations(), []);
    assert.notStrictEqual(panel.generation(), old);
    h.report(panel, true);
    await h.controller.newIssue();
    assert.strictEqual(panel.creations().length, 1);
  });

  test('live-registry removal and disposal prevent late reports or readiness reviving a panel', async () => {
    const h = harness();
    const panel = h.attach();
    h.qualify(panel);
    h.live.delete(panel);
    h.report(panel, true, 1);
    await h.controller.newIssue();
    h.controller.detach(panel);
    h.controller.handleMessage(panel, ready);
    h.report(panel, true, 2);
    await h.controller.newIssue();
    assert.deepStrictEqual(panel.creations(), []);
    await flush();
    assert.strictEqual(h.contexts[h.contexts.length - 1], false);
  });

  test('malformed focus envelopes never invalidate or qualify state and produce no replies', async () => {
    const h = harness();
    const panel = h.attach();
    h.controller.handleMessage(panel, { ...ready, payload: {} });
    assert.deepStrictEqual(panel.messages, []);
    h.controller.handleMessage(panel, ready);
    const requestCount = panel.messages.length;
    h.controller.handleMessage(panel, { type: 'ui.focus', requestId: 'f', payload: { generation: panel.generation(), sequence: 0, focused: 'true' } });
    await h.controller.newIssue();
    assert.deepStrictEqual(panel.creations(), []);
    h.report(panel, true);
    h.controller.handleMessage(panel, { ...ready, requestId: '' });
    assert.strictEqual(panel.messages.length, requestCount);
    assert.strictEqual(h.controller.handleMessage(panel, null), false);
    assert.strictEqual(h.controller.handleMessage(panel, { type: 'unrelated' }), false);
    await h.controller.newIssue();
    assert.deepStrictEqual(panel.creations(), [{ type: 'ui.newIssue' }]);
  });

  test('false throwing and rejected new-issue delivery settle without retries', async () => {
    for (const send of [() => Promise.resolve(false), () => { throw new Error('delivery'); }, () => Promise.reject(new Error('delivery'))]) {
      const h = harness();
      const panel = h.attach();
      h.qualify(panel);
      await flush();
      panel.send = send;
      await assert.doesNotReject(h.controller.newIssue());
      await flush();
      assert.strictEqual(panel.creations().length, 1);
      assert.ok(h.logs.some(line => line.includes('delivery=ui.newIssue status=')));
    }
  });

  test('failed synchronization invalidates eligibility without retrying delivery', async () => {
    const h = harness();
    const panel = h.attach();
    panel.send = () => Promise.reject(new Error('sync'));
    h.qualify(panel);
    await flush();
    h.report(panel, true, 10);
    await h.controller.newIssue();
    assert.deepStrictEqual(panel.creations(), []);
    assert.strictEqual(panel.messages.length, 1);
    assert.strictEqual(h.contexts[h.contexts.length - 1], false);
  });

  test('publisher is one-in-flight and coalesces to the latest wanted value', async () => {
    const calls: ReturnType<typeof deferred<void>>[] = [];
    const h = harness(() => { const call = deferred<void>(); calls.push(call); return call.promise; });
    const panel = h.attach();
    h.qualify(panel);
    h.report(panel, false, 1);
    h.report(panel, true, 2);
    assert.deepStrictEqual(h.contexts, [false]);
    calls[0].resolve();
    await flush();
    assert.deepStrictEqual(h.contexts, [false, true]);
    h.report(panel, false, 3);
    h.report(panel, true, 4);
    calls[1].resolve();
    await flush();
    assert.deepStrictEqual(h.contexts, [false, true]);
    h.report(panel, true, 5);
    assert.deepStrictEqual(h.contexts, [false, true]);
    h.report(panel, false, 6);
    assert.deepStrictEqual(h.contexts, [false, true, false]);
    calls[2].resolve();
    await flush();
  });

  test('stale publication completion converges to newer false rather than retaining true', async () => {
    const pending = deferred<void>();
    const h = harness(value => value ? pending.promise : Promise.resolve());
    await flush();
    const panel = h.attach();
    h.qualify(panel);
    h.report(panel, false, 1);
    assert.deepStrictEqual(h.contexts, [false, true]);
    pending.resolve();
    await flush();
    assert.deepStrictEqual(h.contexts, [false, true, false]);
  });

  test('rejected publication becomes UNKNOWN and retries only on a later validated event', async () => {
    const pending = deferred<void>();
    let rejectNext = true;
    const h = harness(value => value && rejectNext ? pending.promise : Promise.resolve());
    await flush();
    const panel = h.attach();
    h.qualify(panel);
    h.report(panel, false, 1);
    pending.reject(new Error('private /Users/example/internal/file\n' + 'x'.repeat(1000)));
    await flush();
    assert.deepStrictEqual(h.contexts, [false, true]);
    assert.ok(h.logs.some(line => line.includes('publication status=error')));
    assert.ok(h.logs.every(line => line.length <= 512 && !line.includes('/Users/example') && !line.includes('\n')));
    rejectNext = false;
    h.controller.handleMessage(panel, { type: 'ui.focus', requestId: '', payload: { generation: panel.generation(), sequence: 2, focused: false } });
    await flush();
    assert.deepStrictEqual(h.contexts, [false, true]);
    h.report(panel, false, 2);
    assert.deepStrictEqual(h.contexts, [false, true, false]);
    await flush();
    assert.ok(h.logs.every(line => line.startsWith('[Shortcut 2026-10-18T12:00:00.000Z]')));
  });

  test('synchronous publisher failure settles and a lifecycle event republishes unchanged false', async () => {
    let fail = true;
    const h = harness(() => { if (fail) { throw new Error('publisher'); } return Promise.resolve(); });
    await flush();
    assert.deepStrictEqual(h.contexts, [false]);
    fail = false;
    h.controller.windowChanged(false);
    assert.deepStrictEqual(h.contexts, [false, false]);
    await flush();
  });

  test('shutdown handles late true publication and dead reports without requalifying', async () => {
    const pending = deferred<void>();
    const h = harness(value => value ? pending.promise : Promise.resolve());
    await flush();
    const panel = h.attach();
    h.qualify(panel);
    h.controller.dispose();
    h.controller.dispose();
    h.report(panel, true, 10);
    h.controller.handleMessage(panel, ready);
    h.controller.windowChanged(true);
    h.controller.panelChanged(panel);
    await h.controller.newIssue();
    pending.resolve();
    await flush();
    assert.deepStrictEqual(h.contexts, [false, true, false]);
    assert.deepStrictEqual(panel.creations(), []);
    assert.strictEqual(panel.messages.length, 1);
  });

  test('host wiring registers routing and lifecycle and handles focus before logging or read-only replies', () => {
    assertHostWiring(fs.readFileSync(path.join(root, 'src/extension.ts'), 'utf8'));
  });

  for (const [name, ending] of [['LF', '\n'], ['CRLF', '\r\n']]) {
    test(`host wiring accepts ${name} source`, () => {
      assertHostWiring(hostSourceWithLineEnding(ending));
    });

    test(`host wiring rejects missing requirements in ${name} source`, () => {
      const source = hostSourceWithLineEnding(ending);
      assertHostWiring(source);
      const requirements = [
        ["registerCommand('beadsKanban.newIssue', () => shortcut.newIssue())", 'shortcut command registration'],
        ['livePanels,', 'shared registry and current window focus'],
        ['windowFocused: vscode.window.state.focused', 'shared registry and current window focus'],
        ['onDidChangeWindowState(state => shortcut.windowChanged(state.focused))', 'window focus listener'],
        ['panel.onDidChangeViewState(() => shortcut.panelChanged(panel))', 'panel view listener'],
        ['shortcut.detach(panel);', 'panel shortcut detachment'],
        ['if (shortcut.handleMessage(panel, msg)) { return; }', 'focus handling before logging and read-only gate'],
        ['| ShortcutHostMessage', 'unsolicited host message union'],
        ["executeCommand('setContext', 'beadsKanban.boardFocus', focused)", 'board focus context publication']
      ];
      for (const [required, message] of requirements) {
        const missing = source.replace(required, '');
        assert.notStrictEqual(missing, source, `required wiring is present: ${required}`);
        assert.throws(() => assertHostWiring(missing), { name: 'AssertionError', message });
      }
    });
  }
});
