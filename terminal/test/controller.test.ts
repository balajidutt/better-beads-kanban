import assert from 'node:assert/strict';
import test from 'node:test';
import { BrowserController, HIERARCHY_DEPTH_ERROR, MAX_LOADED_ANCESTORS } from '../src/controller';
import type { ReadService } from '../src/contracts';
import type { EnrichedCard, FullCard } from '../../src/shared/model';

function card(id: string, extra: Partial<EnrichedCard> = {}): EnrichedCard {
  return { id, title: id, description: '', status: 'open', priority: 2, issue_type: 'task',
    created_at: '2026-01-01', updated_at: '2026-01-01', created_by: 'tester',
    dependency_count: 0, dependent_count: 0, ...extra };
}
function full(id: string): FullCard {
  return { ...card(id), acceptance_criteria: '', design: '', notes: '' };
}
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: Error) => void;
  const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
}
const settle = async (): Promise<void> => { await new Promise(resolve => setImmediate(resolve)); };
class Service implements ReadService {
  cards: EnrichedCard[] = [];
  lists: number[] = [];
  details: string[] = [];
  disposed = 0;
  listResult: ((limit: number) => Promise<EnrichedCard[]>) | null = null;
  detailResult: ((id: string) => Promise<FullCard>) | null = null;
  async list(limit: number): Promise<EnrichedCard[]> {
    this.lists.push(limit);
    return this.listResult ? this.listResult(limit) : this.cards;
  }
  async detail(id: string): Promise<FullCard> {
    this.details.push(id);
    return this.detailResult ? this.detailResult(id) : full(id);
  }
  dispose(): void { this.disposed++; }
}
async function setup(cards: EnrichedCard[], limit = 1000) {
  const service = new Service();
  service.cards = cards;
  const controller = new BrowserController(service, limit);
  await controller.refresh();
  await settle();
  return { service, controller };
}
const rowIds = (controller: BrowserController) => controller.project().rows.map(row => row.card.id);
const matchIds = (controller: BrowserController) => controller.project().matching.map(item => item.id);

test('one bounded snapshot, honest truncation, default filters and unfamiliar values', async () => {
  const { controller, service } = await setup([
    card('x-a', { issue_type: 'question' }), card('x-b', { status: 'custom' }), card('x-c'),
  ], 2);
  assert.deepEqual(service.lists, [3]);
  assert.equal(controller.getState().view, 'tree');
  assert.equal(controller.getState().cards.length, 2);
  assert.equal(controller.getState().truncated, true);
  assert.ok(controller.getState().lastRefresh);
  assert.deepEqual(matchIds(controller), ['x-a']);
  assert.ok(controller.project().types.includes('question'));
  assert.ok(controller.getState().filters.types.includes('question'));
  assert.ok(controller.project().statuses.includes('custom'));
  assert.deepEqual(service.details, ['x-a']);
  controller.setFilters({ statuses: controller.project().statuses });
  assert.deepEqual(matchIds(controller), ['x-a', 'x-b']);
  controller.cycleView();
  controller.cycleView();
  assert.equal(controller.getState().view, 'kanban');
  assert.deepEqual(service.lists, [3]);
  assert.deepEqual(service.details, ['x-a']);
  controller.cycleView();
  assert.equal(controller.getState().view, 'tree');
});

test('shared sorting, ancestor context, orphan marking and flat view equivalence', async () => {
  const { controller } = await setup([
    card('x-parent', { status: 'closed' }),
    card('x-b', { parent: { id: 'x-parent', title: '' }, updated_at: '2026-02-01' }),
    card('x-a', { parent: { id: 'outside', title: '' }, updated_at: '2026-02-01', blocked_by: [{ id: 'x-b', title: '' }] }),
    card('x-defer', { status: 'deferred' }),
  ]);
  assert.deepEqual(matchIds(controller), ['x-a', 'x-b', 'x-defer']);
  assert.equal(controller.project().rows.find(row => row.card.id === 'x-parent')?.matches, false);
  assert.equal(controller.project().rows.find(row => row.card.id === 'x-a')?.parentNotLoaded, true);
  controller.select('x-parent');
  controller.setView('table');
  assert.equal(controller.getState().selectedId, 'x-defer');
  assert.deepEqual(controller.project().columns.flatMap(column => column.cards.map(item => item.id)).sort(), matchIds(controller).sort());
  assert.deepEqual(controller.project().columns.find(column => column.status === 'open')?.cards.map(item => item.id), ['x-a', 'x-b']);
  assert.deepEqual(controller.project().columns.slice(0, 5).map(column => column.status), ['open', 'in_progress', 'blocked', 'deferred', 'closed']);
});

test('search checks ID/title/description/labels and None/reset semantics', async () => {
  const { controller } = await setup([
    card('x-a', { title: 'TITLE' }), card('x-b', { description: 'Description' }),
    card('x-c', { labels: ['LABEL'], priority: 4, issue_type: 'unknown' }),
  ]);
  for (const [search, id] of [['title', 'x-a'], ['DESCRIPTION', 'x-b'], ['label', 'x-c'], ['X-A', 'x-a']]) {
    controller.setFilters({ search });
    assert.deepEqual(matchIds(controller), [id]);
  }
  controller.setFilters({ statuses: [] });
  assert.deepEqual(rowIds(controller), []);
  assert.equal(controller.getState().selectedId, null);
  assert.equal(controller.getState().detail, null);
  controller.resetFilters();
  assert.deepEqual(matchIds(controller), ['x-a', 'x-b', 'x-c']);
  controller.setFilters({ priorities: ['4'], types: ['unknown'] });
  assert.deepEqual(matchIds(controller), ['x-c']);
});

test('Tree defaults, collapse, temporary reveal and filter auto-expansion preserve overrides', async () => {
  const { controller } = await setup([
    card('x-a'), card('x-b', { parent: { id: 'x-a', title: '' } }),
    card('x-c', { parent: { id: 'x-b', title: '' } }),
  ]);
  assert.deepEqual(rowIds(controller), ['x-a', 'x-b']);
  controller.horizontal(1);
  assert.equal(controller.getState().selectedId, 'x-b');
  controller.horizontal(1);
  assert.deepEqual(rowIds(controller), ['x-a', 'x-b', 'x-c']);
  controller.horizontal(1);
  assert.equal(controller.getState().selectedId, 'x-c');
  controller.horizontal(-1);
  assert.equal(controller.getState().selectedId, 'x-b');
  controller.horizontal(-1);
  assert.deepEqual(rowIds(controller), ['x-a', 'x-b']);
  controller.select('x-a');
  controller.toggle();
  assert.deepEqual(rowIds(controller), ['x-a']);
  const overrides = controller.getState().expanded;
  controller.setView('table');
  controller.select('x-c');
  controller.setView('tree');
  assert.equal(controller.getState().selectedId, 'x-c');
  assert.deepEqual(rowIds(controller), ['x-a', 'x-b', 'x-c']);
  assert.equal(controller.getState().expanded, overrides);
  controller.select('x-a');
  controller.setFilters({ search: 'x-c' });
  assert.deepEqual(rowIds(controller), ['x-a', 'x-b', 'x-c']);
  assert.equal(controller.getState().expanded, overrides);
  controller.resetFilters();
  assert.deepEqual(rowIds(controller), ['x-a']);
});

test('kanban navigates empty columns with no stale selection, stored status grouping and retained viewports', async () => {
  const { controller } = await setup([card('x-a'), card('x-b'), card('x-c', { status: 'blocked' })]);
  controller.setViewport('tree', 8);
  controller.setViewport('table', 12);
  controller.setViewport('kanban', 2);
  controller.setColumnOffset('open', 6);
  controller.setView('kanban');
  controller.move(1);
  assert.equal(controller.getState().selectedId, 'x-b');
  controller.horizontal(1);
  assert.equal(controller.getState().kanbanColumn, 1);
  assert.equal(controller.getState().selectedId, null);
  assert.equal(controller.getState().detail, null);
  controller.move(1);
  assert.equal(controller.getState().selectedId, null);
  controller.horizontal(1);
  assert.equal(controller.getState().selectedId, 'x-c');
  controller.setView('tree');
  controller.setView('table');
  controller.horizontal(1);
  controller.setView('kanban');
  assert.equal(controller.getState().selectedId, 'x-c');
  assert.deepEqual(controller.getState().viewports, { tree: 8, table: 12, kanban: 2 });
  assert.equal(controller.getState().columnOffsets.open, 6);
});

test('immutable stable state, unsubscribing and projection caching on irrelevant publications', async () => {
  const { controller, service } = await setup([card('x-a'), card('x-b')]);
  const state = controller.getState();
  const projection = controller.project();
  assert.equal(controller.getState(), state);
  let notifications = 0;
  const off = controller.subscribe(() => { notifications++; });
  controller.setViewport('tree', 4);
  assert.notEqual(controller.getState(), state);
  assert.equal(state.viewports.tree, 0);
  assert.equal(controller.project(), projection);
  controller.select('x-b');
  await settle();
  assert.equal(controller.project(), projection);
  assert.equal(state.selectedId, 'x-a');
  service.cards[0].title = 'mutated service data';
  assert.equal(controller.getState().cards[0].title, 'x-a');
  assert.ok(Object.isFrozen(state.filters.statuses));
  assert.ok(Object.isFrozen(state.cards[0]));
  off();
  const count = notifications;
  controller.setViewport('table', 1);
  assert.equal(notifications, count);
});

test('serial details retain only newest pending request and reuse cache across switches', async () => {
  const service = new Service();
  service.cards = [card('x-a'), card('x-b'), card('x-c')];
  const a = deferred<FullCard>();
  const c = deferred<FullCard>();
  service.detailResult = id => id === 'x-a' ? a.promise : c.promise;
  const controller = new BrowserController(service);
  await controller.refresh();
  controller.select('x-b');
  controller.select('x-c');
  assert.deepEqual(service.details, ['x-a']);
  a.resolve(full('x-a'));
  await settle();
  assert.deepEqual(service.details, ['x-a', 'x-c']);
  assert.equal(controller.getState().detail, null);
  c.resolve(full('x-c'));
  await settle();
  assert.equal(controller.getState().detail?.id, 'x-c');
  controller.setView('table');
  controller.setView('kanban');
  controller.select('x-a');
  assert.equal(controller.getState().detail?.id, 'x-a');
  assert.deepEqual(service.details, ['x-a', 'x-c']);
});

test('returning to the in-flight selection cancels the obsolete pending detail', async () => {
  const service = new Service();
  service.cards = [card('x-a'), card('x-b')];
  const detail = deferred<FullCard>();
  service.detailResult = () => detail.promise;
  const controller = new BrowserController(service);
  await controller.refresh();
  controller.select('x-b');
  controller.select('x-a');
  detail.resolve(full('x-a'));
  await settle();
  assert.deepEqual(service.details, ['x-a']);
  assert.equal(controller.getState().detail?.id, 'x-a');
});

test('latest refresh wins and prior-generation detail cannot enter the new cache', async () => {
  const service = new Service();
  service.cards = [card('x-a')];
  const oldDetail = deferred<FullCard>();
  service.detailResult = () => oldDetail.promise;
  const controller = new BrowserController(service);
  await controller.refresh();
  const oldList = deferred<EnrichedCard[]>();
  const newList = deferred<EnrichedCard[]>();
  service.listResult = () => oldList.promise;
  const first = controller.refresh();
  service.listResult = () => newList.promise;
  const second = controller.refresh();
  oldList.resolve([card('x-obsolete')]);
  await first;
  assert.equal(controller.getState().cards[0].id, 'x-a');
  newList.resolve([card('x-a', { title: 'new' }), card('x-b')]);
  await second;
  assert.deepEqual(service.details, ['x-a']);
  assert.equal(controller.getState().cards[0].title, 'new');
  const newDetail = deferred<FullCard>();
  service.detailResult = () => newDetail.promise;
  oldDetail.resolve({ ...full('x-a'), notes: 'obsolete' });
  await settle();
  assert.deepEqual(service.details, ['x-a', 'x-a']);
  assert.equal(controller.getState().detail, null);
  newDetail.resolve({ ...full('x-a'), notes: 'fresh' });
  await settle();
  assert.equal(controller.getState().detail?.notes, 'fresh');
});

test('refresh failure retains stale snapshot and time; deletion falls back nearby then clears', async () => {
  const { controller, service } = await setup([card('x-a'), card('x-b'), card('x-c')]);
  controller.select('x-b');
  await settle();
  const { cards, lastRefresh } = controller.getState();
  service.listResult = async () => { throw new Error('offline'); };
  await controller.refresh();
  assert.equal(controller.getState().cards, cards);
  assert.equal(controller.getState().lastRefresh, lastRefresh);
  assert.equal(controller.getState().stale, true);
  assert.equal(controller.getState().error, 'offline');
  service.listResult = null;
  service.cards = [card('x-a'), card('x-c')];
  await controller.refresh();
  assert.equal(controller.getState().selectedId, 'x-c');
  assert.equal(controller.getState().stale, false);
  service.cards = [];
  await controller.refresh();
  assert.equal(controller.getState().selectedId, null);
  assert.equal(controller.getState().detail, null);
  assert.deepEqual(matchIds(controller), []);
});

test('detail failures are selection-specific and disposal blocks late writes and pending reads', async () => {
  const service = new Service();
  service.cards = [card('x-a'), card('x-b')];
  const a = deferred<FullCard>();
  const b = deferred<FullCard>();
  service.detailResult = id => id === 'x-a' ? a.promise : b.promise;
  const controller = new BrowserController(service);
  await controller.refresh();
  a.reject(new Error('issue not found'));
  await settle();
  assert.equal(controller.getState().detailError, 'issue not found');
  controller.select('x-b');
  assert.equal(controller.getState().detailError, null);
  controller.select('x-a');
  const state = controller.getState();
  controller.dispose();
  controller.dispose();
  b.resolve(full('x-b'));
  await settle();
  await controller.refresh();
  controller.setView('table');
  assert.equal(controller.getState(), state);
  assert.equal(service.disposed, 1);
  assert.deepEqual(service.details, ['x-a', 'x-b']);
});

test('new unfamiliar types join defaults on refresh but explicit type restrictions survive', async () => {
  const { controller, service } = await setup([card('x-a')]);
  service.cards = [card('x-a'), card('x-b', { issue_type: 'new' })];
  await controller.refresh();
  assert.deepEqual(matchIds(controller), ['x-a', 'x-b']);
  controller.setFilters({ types: ['task'] });
  service.cards.push(card('x-c', { issue_type: 'other' }));
  await controller.refresh();
  assert.deepEqual(matchIds(controller), ['x-a']);
  controller.resetFilters();
  assert.deepEqual(matchIds(controller), ['x-a', 'x-b', 'x-c']);
});

test('collapsing a temporarily revealed nested branch keeps the selected branch visible', async () => {
  const { controller } = await setup([
    card('x-a'), card('x-b', { parent: { id: 'x-a', title: '' } }),
    card('x-c', { parent: { id: 'x-b', title: '' } }),
  ]);
  controller.toggle();
  controller.setView('table');
  controller.select('x-c');
  controller.setView('tree');
  controller.horizontal(-1);
  controller.horizontal(-1);
  assert.equal(controller.getState().selectedId, 'x-b');
  assert.deepEqual(rowIds(controller), ['x-a', 'x-b']);
  assert.deepEqual(controller.getState().expanded, { 'x-a': false, 'x-b': false });
});

test('obsolete failures cannot overwrite current selection, and failed details are cached until refresh', async () => {
  const service = new Service();
  service.cards = [card('x-a'), card('x-b')];
  const a = deferred<FullCard>();
  service.detailResult = id => id === 'x-a' ? a.promise : Promise.resolve(full(id));
  const controller = new BrowserController(service);
  await controller.refresh();
  controller.select('x-b');
  a.reject(new Error('gone'));
  await settle();
  assert.equal(controller.getState().detail?.id, 'x-b');
  assert.equal(controller.getState().detailError, null);
  controller.select('x-a');
  assert.equal(controller.getState().detailError, 'gone');
  controller.setView('table');
  controller.setView('kanban');
  assert.deepEqual(service.details, ['x-a', 'x-b']);
  service.detailResult = id => Promise.resolve(full(id));
  await controller.refresh();
  await settle();
  assert.deepEqual(service.details, ['x-a', 'x-b', 'x-a']);
  assert.equal(controller.getState().detailError, null);
});

test('a superseded refresh failure cannot mark the snapshot stale and disposal ignores list completion', async () => {
  const { controller, service } = await setup([card('x-a')]);
  const old = deferred<EnrichedCard[]>();
  service.listResult = () => old.promise;
  const first = controller.refresh();
  service.listResult = async () => [card('x-b')];
  const second = controller.refresh();
  old.reject(new Error('obsolete failure'));
  await first;
  await second;
  assert.equal(controller.getState().stale, false);
  assert.equal(controller.getState().error, null);
  assert.equal(controller.getState().selectedId, 'x-b');
  const last = deferred<EnrichedCard[]>();
  service.listResult = () => last.promise;
  const finalRefresh = controller.refresh();
  controller.dispose();
  const state = controller.getState();
  last.resolve([card('x-c')]);
  await finalRefresh;
  assert.equal(controller.getState(), state);
});

test('25 refresh calls run one active list and one newest pending list with shared pending promises', async () => {
  const service = new Service();
  const active = deferred<EnrichedCard[]>();
  const pending = deferred<EnrichedCard[]>();
  let concurrent = 0;
  let maximum = 0;
  service.listResult = async () => {
    concurrent++;
    maximum = Math.max(maximum, concurrent);
    try { return await (service.lists.length === 1 ? active.promise : pending.promise); }
    finally { concurrent--; }
  };
  const controller = new BrowserController(service);
  const publications: string[][] = [];
  controller.subscribe(() => { publications.push(controller.getState().cards.map(item => item.id)); });
  const first = controller.refresh();
  const requests = Array.from({ length: 24 }, () => controller.refresh());
  assert.ok(requests.every(request => request === requests[0]));
  assert.notEqual(first, requests[0]);
  let firstSettled = false;
  let pendingSettled = false;
  void first.then(() => { firstSettled = true; });
  void requests[0].then(() => { pendingSettled = true; });
  await settle();
  assert.equal(firstSettled, false);
  assert.equal(pendingSettled, false);
  assert.deepEqual(service.lists, [1001]);
  active.resolve([card('x-obsolete')]);
  await first;
  assert.equal(firstSettled, true);
  assert.equal(pendingSettled, false);
  assert.equal(controller.getState().loading, true);
  assert.deepEqual(controller.getState().cards, []);
  assert.deepEqual(service.details, []);
  assert.deepEqual(service.lists, [1001, 1001]);
  pending.resolve([card('x-newest')]);
  await Promise.all(requests);
  assert.equal(pendingSettled, true);
  assert.equal(maximum, 1);
  assert.equal(concurrent, 0);
  assert.equal(controller.getState().loading, false);
  assert.deepEqual(matchIds(controller), ['x-newest']);
  assert.ok(publications.every(ids => !ids.includes('x-obsolete')));
  assert.deepEqual(service.details, ['x-newest']);
});

test('coalesced failure settles all pending callers and preserves the last successful snapshot', async () => {
  const { controller, service } = await setup([card('x-good')]);
  const cards = controller.getState().cards;
  const active = deferred<EnrichedCard[]>();
  const pending = deferred<EnrichedCard[]>();
  service.listResult = () => active.promise;
  const first = controller.refresh();
  service.listResult = () => pending.promise;
  const second = controller.refresh();
  const third = controller.refresh();
  assert.equal(second, third);
  active.reject(new Error('superseded'));
  await first;
  assert.equal(controller.getState().error, null);
  assert.equal(controller.getState().stale, false);
  assert.equal(controller.getState().loading, true);
  pending.reject(new Error('newest failure'));
  await Promise.all([second, third]);
  assert.equal(controller.getState().error, 'newest failure');
  assert.equal(controller.getState().stale, true);
  assert.equal(controller.getState().loading, false);
  assert.equal(controller.getState().cards, cards);
});

test('disposal settles active and pending refresh promises without starting the pending list', async () => {
  const service = new Service();
  const list = deferred<EnrichedCard[]>();
  service.listResult = () => list.promise;
  const controller = new BrowserController(service);
  const first = controller.refresh();
  const second = controller.refresh();
  controller.dispose();
  const state = controller.getState();
  await Promise.all([first, second]);
  assert.deepEqual(service.lists, [1001]);
  list.resolve([card('x-late')]);
  await settle();
  assert.equal(controller.getState(), state);
  assert.deepEqual(service.lists, [1001]);
  assert.deepEqual(service.details, []);
});

function chain(length: number): EnrichedCard[] {
  return Array.from({ length }, (_, index) => card(`x-${String(index).padStart(4, '0')}`,
    index ? { parent: { id: `x-${String(index - 1).padStart(4, '0')}`, title: '' } } : {}));
}

test('a 5000-issue chain is rejected on first load without publishing corrupt cards or selection', async () => {
  const service = new Service();
  service.cards = chain(5000);
  const controller = new BrowserController(service, 5000);
  const initial = controller.getState();
  controller.subscribe(() => {
    assert.equal(controller.getState().cards, initial.cards);
    assert.deepEqual(rowIds(controller), []);
  });
  await controller.refresh();
  assert.equal(controller.getState().error, HIERARCHY_DEPTH_ERROR);
  assert.ok(HIERARCHY_DEPTH_ERROR.includes(String(MAX_LOADED_ANCESTORS)));
  assert.equal(controller.getState().stale, true);
  assert.equal(controller.getState().loading, false);
  assert.equal(controller.getState().lastRefresh, null);
  assert.equal(controller.getState().selectedId, null);
  assert.equal(controller.getState().filters, initial.filters);
  assert.deepEqual(service.details, []);
});

test('unsupported depth preserves last-good snapshot, selection, filters, expansion, viewports and timestamp', async () => {
  const { controller, service } = await setup(chain(3), 5000);
  controller.toggle();
  controller.setViewport('tree', 7);
  controller.setColumnOffset('open', 3);
  const good = controller.getState();
  const projection = controller.project();
  const observed: EnrichedCard[][] = [];
  controller.subscribe(() => { observed.push(controller.getState().cards); });
  service.cards = chain(5000);
  await controller.refresh();
  const state = controller.getState();
  assert.equal(state.error, HIERARCHY_DEPTH_ERROR);
  assert.equal(state.stale, true);
  assert.equal(state.cards, good.cards);
  assert.equal(state.selectedId, good.selectedId);
  assert.equal(state.filters, good.filters);
  assert.equal(state.expanded, good.expanded);
  assert.equal(state.viewports, good.viewports);
  assert.equal(state.columnOffsets, good.columnOffsets);
  assert.equal(state.lastRefresh, good.lastRefresh);
  assert.equal(state.truncated, good.truncated);
  assert.equal(controller.project(), projection);
  assert.ok(observed.every(cards => cards === good.cards));
  service.cards = [card('x-recovered')];
  await controller.refresh();
  assert.equal(controller.getState().stale, false);
  assert.equal(controller.getState().error, null);
  assert.deepEqual(matchIds(controller), ['x-recovered']);
});

test('depth boundary supports 512 loaded ancestors and rejects 513 even when filters hide them', async () => {
  const { controller, service } = await setup(chain(MAX_LOADED_ANCESTORS + 1), 5000);
  assert.equal(controller.getState().error, null);
  controller.setFilters({ search: `x-${String(MAX_LOADED_ANCESTORS).padStart(4, '0')}` });
  assert.equal(controller.project().rows.length, MAX_LOADED_ANCESTORS + 1);
  assert.equal(controller.project().rows.at(-1)?.depth, MAX_LOADED_ANCESTORS);
  const good = controller.getState().cards;
  controller.setFilters({ statuses: [] });
  service.cards = chain(MAX_LOADED_ANCESTORS + 2);
  await controller.refresh();
  assert.equal(controller.getState().error, HIERARCHY_DEPTH_ERROR);
  assert.equal(controller.getState().cards, good);
});

test('depth guard terminates for cycles, self-parents and orphans without altering shared tree semantics', async () => {
  const { controller, service } = await setup([
    card('x-a', { parent: { id: 'x-b', title: '' } }),
    card('x-b', { parent: { id: 'x-a', title: '' } }),
    card('x-self', { parent: { id: 'x-self', title: '' } }),
    card('x-orphan', { parent: { id: 'outside', title: '' } }),
  ], 5000);
  assert.equal(controller.getState().error, null);
  assert.deepEqual(rowIds(controller), ['x-b', 'x-a', 'x-orphan', 'x-self']);
  assert.equal(controller.project().rows.find(row => row.card.id === 'x-orphan')?.parentNotLoaded, true);
  service.cards = chain(5000);
  service.cards[0].parent = { id: service.cards.at(-1)!.id, title: '' };
  await controller.refresh();
  assert.equal(controller.getState().error, HIERARCHY_DEPTH_ERROR);
  assert.equal(controller.getState().cards.length, 4);
});

test('candidate projection errors cannot commit any part of the snapshot', async () => {
  const { controller, service } = await setup([card('x-good', { title: 'needle' })]);
  controller.setFilters({ search: 'needle' });
  const good = controller.getState();
  const observed: EnrichedCard[][] = [];
  controller.subscribe(() => { observed.push(controller.getState().cards); });
  service.cards = [card('x-invalid', { title: null as unknown as string, issue_type: 'new-type' })];
  await controller.refresh();
  assert.ok(controller.getState().error);
  assert.equal(controller.getState().stale, true);
  assert.equal(controller.getState().cards, good.cards);
  assert.equal(controller.getState().filters, good.filters);
  assert.equal(controller.getState().expanded, good.expanded);
  assert.equal(controller.getState().selectedId, good.selectedId);
  assert.equal(controller.getState().lastRefresh, good.lastRefresh);
  assert.deepEqual(matchIds(controller), ['x-good']);
  assert.ok(observed.every(cards => cards === good.cards));
});
