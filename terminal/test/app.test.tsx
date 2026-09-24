import assert from 'node:assert/strict';
import test from 'node:test';
import { setTimeout as delay } from 'node:timers/promises';
import React from 'react';
import { render } from 'ink-testing-library';
import stripAnsi from 'strip-ansi';
import stringWidth from 'string-width';
import { App, type AppProps } from '../src/app';
import { BrowserController } from '../src/controller';
import type { EnrichedCard, FullCard } from '../../src/shared/model';

const tick = (): Promise<void> => delay(40);
function card(id: string, extra: Partial<EnrichedCard> = {}): EnrichedCard {
  return { id, title: `Title ${id}`, description: '', status: 'open', priority: 2, issue_type: 'task',
    created_at: '2026-01-01', updated_at: '2026-01-01', created_by: 'tester', dependency_count: 0, dependent_count: 0, ...extra };
}
async function setup(cards: EnrichedCard[], options: Partial<AppProps> = {}, limit = 1000) {
  let exits = 0;
  let lists = 0;
  const reads: string[] = [];
  const controller = new BrowserController({
    async list() { lists++; return cards; },
    async detail(id) {
      reads.push(id);
      return { ...cards.find(item => item.id === id)!, description: Array.from({ length: 30 }, (_, i) => `Detail line ${i}`).join('\n'),
        acceptance_criteria: 'accepted', design: 'design source', notes: 'notes source', labels: ['label'], assignee: 'person',
        comments: [{ id: 1, issue_id: id, author: 'author', text: 'comment body', created_at: '2026-01-02' }],
      } satisfies FullCard;
    },
    dispose() {},
  }, limit);
  await controller.refresh();
  await tick();
  const props: AppProps = { controller, repo: '/repo', version: '1.2.2', clipboard: 'manual', onExit: () => { exits++; }, width: 120, height: 30, ...options };
  const screen = render(<App {...props} />);
  await tick();
  const frame = (): string => stripAnsi(screen.lastFrame() ?? '');
  const press = async (key: string): Promise<void> => { screen.stdin.write(key); await tick(); };
  return { controller, screen, props, frame, press, reads, lists: () => lists, exits: () => exits,
    close() { screen.unmount(); screen.cleanup(); controller.dispose(); } };
}

test('three views share selection/details and snapshot; keys and copy stay read-only', async () => {
  const app = await setup([card('x-a'), card('x-b')]);
  try {
    assert.match(app.frame(), / TREE /u);
    assert.match(app.frame(), /Details/u);
    assert.match(app.frame(), /2 visible · 2 matching \/ 2 loaded/u);
    await app.press('v');
    assert.match(app.frame(), / TABLE /u);
    assert.match(app.frame(), /ID\s+Title\s+Status\s+Pri\s+Type/u);
    await app.press('v');
    assert.match(app.frame(), / KANBAN /u);
    assert.match(app.frame(), /Open \(2\)/u);
    assert.deepEqual(app.reads, ['x-a']);
    await app.press('j');
    assert.equal(app.controller.getState().selectedId, 'x-b');
    await app.press('y');
    assert.match(app.frame(), /Copy manually: x-b/u);
    await app.press('v');
    assert.equal(app.controller.getState().selectedId, 'x-b');
    assert.equal(app.lists(), 1);
    await app.press('q');
    await app.press('\x03');
    assert.equal(app.exits(), 2);
  } finally { app.close(); }
});

test('search captures shortcut characters; filter tabs support None/All/Active/reset', async () => {
  const app = await setup([card('x-a', { title: 'qrvfy match' }), card('x-b', { status: 'closed', issue_type: 'strange' })]);
  try {
    await app.press('/');
    await app.press('qrvfy');
    assert.equal(app.controller.getState().filters.search, 'qrvfy');
    assert.equal(app.controller.getState().view, 'tree');
    assert.equal(app.exits(), 0);
    assert.equal(app.lists(), 1);
    await app.press('\x1b');
    await app.press('f');
    await app.press('n');
    assert.deepEqual(app.controller.getState().filters.statuses, []);
    await app.press('a');
    assert.ok(app.controller.getState().filters.statuses.includes('closed'));
    await app.press('s');
    assert.ok(!app.controller.getState().filters.statuses.includes('closed'));
    await app.press('\t');
    assert.match(app.frame(), /\[Priority\]/u);
    await app.press('n');
    assert.deepEqual(app.controller.getState().filters.priorities, []);
    await app.press(' ');
    assert.deepEqual(app.controller.getState().filters.priorities, ['0']);
    await app.press('\t');
    assert.match(app.frame(), /\[Type\]/u);
    await app.press('n');
    assert.deepEqual(app.controller.getState().filters.types, []);
    await app.press('r');
    assert.equal(app.controller.getState().filters.search, '');
    assert.ok(app.controller.getState().filters.types.includes('strange'));
    await app.press('q');
    assert.equal(app.exits(), 0);
    await app.press('\x1b');
    await app.press('?');
    assert.match(app.frame(), /Minimum split-pane size: 100×24/u);
  } finally { app.close(); }
});

test('tree connectors, context, orphan markers and hierarchy keys use projected rows', async () => {
  const app = await setup([card('x-parent', { status: 'closed' }), card('x-child', { parent: { id: 'x-parent', title: '' } }),
    card('x-orphan', { parent: { id: 'x-missing', title: '' } })], { width: 160 });
  try {
    assert.match(app.frame(), /└─/u);
    assert.match(app.frame(), /parent not loaded/u);
    app.controller.select('x-parent'); await tick();
    await app.press(' ');
    assert.equal(app.controller.project().rows.some(row => row.card.id === 'x-child'), false);
    await app.press('\x1b[C');
    await app.press('\x1b[C');
    assert.equal(app.controller.getState().selectedId, 'x-child');
    await app.press('\x1b[D');
    assert.equal(app.controller.getState().selectedId, 'x-parent');
    await app.press('v');
    assert.ok(!app.frame().split('Details')[0].includes('x-parent'));
    assert.equal(app.controller.project().matching.length, 2);
  } finally { app.close(); }
});

test('table paging keeps selection visible; details scroll independently and reveal full fields', async () => {
  const app = await setup(Array.from({ length: 70 }, (_, i) => card(`x-${String(i).padStart(3, '0')}`)), { width: 160 });
  try {
    await app.press('v');
    assert.match(app.frame(), /Assignee/u);
    await app.press('\x1b[6~');
    assert.ok(app.controller.getState().viewports.table > 0);
    assert.match(app.frame(), new RegExp(`● ${app.controller.getState().selectedId}`));
    const selected = app.controller.getState().selectedId;
    await app.press('\t');
    await app.press('\x1b[6~');
    assert.equal(app.controller.getState().selectedId, selected);
    assert.match(app.frame(), /Focus: DETAILS/u);
    await app.press('\x1b[6~');
    assert.match(app.frame(), /Acceptance criteria: accepted/u);
    assert.match(app.frame(), /Comment author/u);
    await app.press('\x1b[5~');
    assert.equal(app.controller.getState().selectedId, selected);
  } finally { app.close(); }
});

test('Kanban windows cards and stored-status columns, including empty columns', async () => {
  const cards = Array.from({ length: 30 }, (_, i) => card(`x-${String(i).padStart(3, '0')}`, { blocked_by: [{ id: 'x-blocker', title: '' }] }));
  cards.push(card('x-deferred', { status: 'deferred' }), card('x-closed', { status: 'closed' }), card('x-custom', { status: 'custom' }));
  const app = await setup(cards);
  try {
    app.controller.setFilters({ statuses: app.controller.project().statuses });
    app.controller.setView('kanban'); await tick();
    assert.match(app.frame(), /Open \(30\)/u);
    assert.doesNotMatch(app.frame(), /Closed \(1\)/u);
    await app.press('\x1b[6~');
    assert.ok(app.controller.getState().columnOffsets.open > 0);
    assert.doesNotMatch(app.frame(), /Title x-029/u);
    await app.press('\x1b[C');
    assert.equal(app.controller.getState().selectedId, null);
    assert.match(app.frame(), /No selection/u);
    for (let i = 0; i < 4; i++) { await app.press('\x1b[C'); }
    assert.match(app.frame(), /custom \(1\)/u);
    assert.match(app.frame(), /Closed \(1\)/u);
    assert.equal(app.controller.getState().selectedId, 'x-custom');
    assert.ok(app.controller.getState().viewports.kanban > 0);
    assert.equal(app.lists(), 1);
  } finally { app.close(); }
});

test('prototype-named statuses can be selected in filters and render cards during column navigation', async () => {
  const statuses = ['__proto__', 'constructor', 'toString'];
  const app = await setup(statuses.map((status, index) => card(`x-${index}`, { status })));
  try {
    await app.press('f');
    await app.press('a');
    for (const status of statuses) {
      assert.ok(app.controller.getState().filters.statuses.includes(status));
      assert.ok(app.frame().includes(`[x] ${status}`));
    }
    await app.press('\x1b');
    await app.press('v');
    await app.press('v');
    for (const [index, status] of statuses.entries()) {
      assert.equal(app.controller.getState().selectedId, `x-${index}`);
      assert.ok(app.frame().includes(`${status} (1)`));
      assert.ok(app.frame().includes(`● x-${index} P2`));
      assert.match(app.frame(), /[12] visible · 3 matching \/ 3 loaded/u);
      assert.doesNotMatch(app.frame(), /\[object Object\]|function|NaN/u);
      assert.equal(Object.hasOwn(app.controller.getState().columnOffsets, status), false);
      if (index < statuses.length - 1) { await app.press('\x1b[C'); }
    }
    await app.press('\x1b[D');
    assert.equal(app.controller.getState().selectedId, 'x-1');
    assert.ok(app.frame().includes('● x-1 P2'));
    assert.equal(app.lists(), 1);
  } finally { app.close(); }
});

test('prototype-named status columns retain own scroll offsets and keep selected cards visible', async () => {
  const statuses = ['__proto__', 'constructor', 'toString'];
  const app = await setup(statuses.flatMap((status, column) => Array.from({ length: 15 }, (_, row) =>
    card(`x-${column}-${String(row).padStart(2, '0')}`, { status }))));
  try {
    await app.press('f');
    await app.press('a');
    await app.press('\x1b');
    await app.press('v');
    await app.press('v');
    for (const [index, status] of statuses.entries()) {
      await app.press('\x1b[6~');
      const state = app.controller.getState();
      assert.equal(Object.hasOwn(state.columnOffsets, status), true);
      assert.ok(Number.isFinite(state.columnOffsets[status]) && state.columnOffsets[status] > 0);
      assert.ok(app.frame().includes(`${status} (15)`));
      assert.ok(app.frame().includes(`● ${state.selectedId} P2`));
      assert.doesNotMatch(app.frame(), /\[object Object\]|function|NaN/u);
      if (index < statuses.length - 1) { await app.press('\x1b[C'); }
    }
    const offsets = { ...app.controller.getState().columnOffsets };
    await app.press('\x1b[D');
    assert.ok(app.frame().includes(`● ${app.controller.getState().selectedId} P2`));
    assert.equal(app.controller.getState().columnOffsets.__proto__, offsets.__proto__);
    assert.equal(app.controller.getState().columnOffsets.toString, offsets.toString);
  } finally { app.close(); }
});

test('partial warnings in every view; resizing preserves state and hostile text is inert', async () => {
  const attack = '\x1b]52;c;cHduZWQ=\x07\x1b[2J\x9b31m\u202e';
  const app = await setup([card('x-a', { title: `你好👩‍💻${attack}safe`, issue_type: `task${attack}` }), card('x-b')], { repo: `/repo${attack}`, version: `bd${attack}` }, 1);
  try {
    for (let i = 0; i < 3; i++) {
      assert.match(app.frame(), /PARTIAL: filters\/counts cover loaded issues only/u);
      assert.doesNotMatch(app.frame(), /cHduZWQ|\x9b|\u202e/u);
      for (const line of app.frame().split('\n')) { assert.ok(stringWidth(line) <= 120, line); }
      const state = app.controller.getState();
      app.screen.rerender(<App {...app.props} width={60} height={15} />); await tick();
      assert.match(app.frame(), /Resize terminal/u);
      await app.press('j');
      assert.equal(app.controller.getState(), state);
      app.screen.rerender(<App {...app.props} />); await tick();
      assert.equal(app.controller.getState().selectedId, state.selectedId);
      assert.equal(app.controller.getState().view, state.view);
      await app.press('v');
    }
  } finally { app.close(); }
});

test('stdout dimensions respond to resize and the listener is removed on unmount', async () => {
  const originalColumns = Object.getOwnPropertyDescriptor(process.stdout, 'columns');
  const originalRows = Object.getOwnPropertyDescriptor(process.stdout, 'rows');
  const listeners = process.stdout.listenerCount('resize');
  Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 });
  Object.defineProperty(process.stdout, 'rows', { configurable: true, value: 30 });
  const app = await setup([card('x-a')], { width: undefined, height: undefined });
  try {
    assert.match(app.frame(), / TREE /u);
    const selected = app.controller.getState().selectedId;
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 60 });
    process.stdout.emit('resize'); await tick();
    assert.match(app.frame(), /Resize terminal/u);
    Object.defineProperty(process.stdout, 'columns', { configurable: true, value: 120 });
    process.stdout.emit('resize'); await tick();
    assert.match(app.frame(), / TREE /u);
    assert.equal(app.controller.getState().selectedId, selected);
  } finally {
    app.close();
    await tick();
    if (originalColumns) { Object.defineProperty(process.stdout, 'columns', originalColumns); } else { Reflect.deleteProperty(process.stdout, 'columns'); }
    if (originalRows) { Object.defineProperty(process.stdout, 'rows', originalRows); } else { Reflect.deleteProperty(process.stdout, 'rows'); }
  }
  assert.equal(process.stdout.listenerCount('resize'), listeners);
});

test('hostile backend errors are rendered inertly while the last snapshot stays visible', async () => {
  let fail = false;
  const hostile = '\x1b]52;c;cHduZWQ=\x07\x1b[2J\u202eoffline';
  const controller = new BrowserController({
    async list() { if (fail) { throw new Error(hostile); } return [card('x-a')]; },
    async detail() { throw new Error(hostile); },
    dispose() {},
  });
  await controller.refresh(); await tick();
  const app = await setup([], { controller });
  try {
    fail = true;
    await app.press('r');
    assert.match(app.frame(), /STALE/u);
    assert.match(app.frame(), /offline/u);
    assert.match(app.frame(), /x-a/u);
    assert.doesNotMatch(app.frame(), /cHduZWQ|\u202e/u);
  } finally { app.close(); controller.dispose(); }
});

test('selection dots, branch triangles, bounded badges and single-line tabs are distinct', async () => {
  const app = await setup([card('parent'), card('leaf', { parent: { id: 'parent', title: '' } })], { width: 100 });
  try {
    app.controller.select('leaf'); await tick();
    const leaf = app.frame().split('\n').find(line => line.startsWith('│●'))!;
    assert.match(leaf, /leaf.*\[P2\] \[task\]/u);
    assert.doesNotMatch(leaf, /[▸▾›]/u);
    assert.match(app.frame(), /▾ parent/u);
    app.controller.select('parent'); await tick();
    await app.press(' ');
    assert.match(app.frame(), /● ▸ parent/u);
    for (const view of ['TREE', 'TABLE', 'KANBAN']) {
      const header = app.frame().split('\n')[1];
      assert.match(header, new RegExp(` ${view} `));
      assert.match(header, /Focus: MAIN.*v cycle · Tab focus · \? help/u);
      assert.ok(stringWidth(header) <= 100);
      assert.doesNotMatch(app.frame(), /›/u);
      if (view !== 'TREE') {
        assert.match(app.frame(), /● parent/u);
        assert.doesNotMatch(app.frame(), /[▸▾]/u);
      }
      await app.press('v');
    }
    await app.press('\t');
    assert.match(app.frame().split('\n')[1], /Focus: DETAILS/u);
    assert.equal(app.frame().split('\n').length, 30);
  } finally { app.close(); }
});

test('copy notices expire, identical copies restart the timer, and unmount clears it', async context => {
  const app = await setup([card('x-copy')]);
  const realSetTimeout = globalThis.setTimeout;
  const realClearTimeout = globalThis.clearTimeout;
  type Timer = ReturnType<typeof setTimeout>;
  const pending = new Map<Timer, { due: number; fire: () => void }>();
  const registered: Timer[] = [];
  const cleared = new Set<Timer>();
  let now = 0;
  context.mock.method(globalThis, 'setTimeout', (...args: Parameters<typeof setTimeout>) => {
    const [callback, milliseconds, ...callbackArgs] = args;
    if (milliseconds !== 4000) { return realSetTimeout(...args); }
    const timer = realSetTimeout(() => {}, 4000);
    realClearTimeout(timer);
    registered.push(timer);
    pending.set(timer, { due: now + milliseconds, fire: () => callback(...callbackArgs) });
    return timer;
  });
  context.mock.method(globalThis, 'clearTimeout', (timer: Parameters<typeof clearTimeout>[0]) => {
    if (typeof timer === 'object' && timer !== null && registered.includes(timer)) {
      cleared.add(timer);
      pending.delete(timer);
    }
    realClearTimeout(timer);
  });
  const advance = (milliseconds: number): void => {
    now += milliseconds;
    for (const [timer, entry] of pending) {
      if (entry.due <= now) { pending.delete(timer); entry.fire(); }
    }
  };
  const waitFor = async (condition: () => boolean, message: string): Promise<void> => {
    for (let attempt = 0; attempt < 50 && !condition(); attempt++) { await tick(); }
    assert.ok(condition(), message);
  };
  const hasNotice = (): boolean => app.frame().includes('Copy manually: x-copy');
  const copy = async (count: number): Promise<void> => {
    app.screen.stdin.write('y');
    await waitFor(() => registered.length === count && hasNotice(), `copy ${count} must display and register its 4000 ms timer`);
  };
  try {
    await copy(1);
    advance(3999); await tick();
    assert.ok(hasNotice());
    advance(1);
    await waitFor(() => !hasNotice(), 'first notice must expire at 4000 ms');
    assert.equal(pending.size, 0);

    await copy(2);
    advance(3000);
    await copy(3);
    assert.ok(cleared.has(registered[1]), 'identical copy must clear the previous notice timer');
    assert.equal(pending.size, 1);
    assert.equal(pending.get(registered[2])?.due, now + 4000);
    advance(1000); await tick();
    assert.ok(hasNotice(), 'previous deadline must not dismiss the repeated notice');
    advance(2999); await tick();
    assert.ok(hasNotice());
    advance(1);
    await waitFor(() => !hasNotice(), 'repeated notice must expire at its own 4000 ms deadline');

    await copy(4);
    app.close(); await tick();
    assert.ok(cleared.has(registered[3]), 'unmount must clear the outstanding notice timer');
    assert.equal(pending.size, 0);
    const frames = app.screen.frames.length;
    advance(5000); await tick();
    assert.equal(app.screen.frames.length, frames);
  } finally { app.close(); context.mock.restoreAll(); }
});

test('Kanban allocates every cell with one-cell gaps, including fewer columns and Unicode', async () => {
  const statuses = ['open', 'in_progress', 'blocked', 'deferred', 'closed'];
  const app = await setup(statuses.map((status, index) => card(`x-${index}`, { status, title: '界'.repeat(100) })));
  try {
    app.controller.setFilters({ statuses });
    app.controller.setView('kanban');
    const cases: [number, number[]][] = [[100, [29, 28]], [145, [42, 42]], [147, [28, 28, 28]], [400, [47, 47, 47, 47, 46]]];
    for (const [width, allocations] of cases) {
      Object.defineProperty(app.screen.stdout, 'columns', { configurable: true, value: width });
      app.screen.rerender(<App {...app.props} width={width} />); await tick();
      const mainWidth = Math.floor(width * 0.6);
      const titleLine = app.frame().split('\n').find(line => line.startsWith('│界'))!;
      const expected = allocations.map(size => {
        const title = '界'.repeat(Math.floor((size - 1) / 2)) + '…';
        return title + ' '.repeat(size - stringWidth(title));
      }).join(' ');
      assert.ok(titleLine.startsWith(`│${expected}│`), JSON.stringify({ width, expected, titleLine, cells: stringWidth(titleLine.split('│')[1]) }));
      assert.equal(stringWidth(expected), mainWidth - 2);
      for (const line of app.frame().split('\n')) { assert.ok(stringWidth(line) <= width, line); }
      assert.match(app.frame(), new RegExp(`columns 1–${allocations.length}/5`));
    }
  } finally { app.close(); }
});
