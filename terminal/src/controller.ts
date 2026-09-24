import {
  buildDisplayTree, defaultExpanded, DEFAULT_TREE_SORT, flattenVisibleRows,
  type EnrichedCard, type FullCard, type TreeNode,
} from '../../src/shared/model';
import { PRIORITY_ALL_VALUES, STATUS_ACTIVE_VALUES, STATUS_ALL_VALUES, TYPE_ALL_VALUES } from '../../src/filterUniverse';
import type { BrowserState, Filters, Projection, ReadService, View } from './contracts';

export const MAX_LOADED_ANCESTORS = 512;
export const HIERARCHY_DEPTH_ERROR = `Unsupported hierarchy depth: loaded parent chains may contain at most ${MAX_LOADED_ANCESTORS} ancestors (counting unique links before a cycle repeats).`;

function validateDepth(cards: EnrichedCard[]): void {
  const byId = new Map(cards.map(card => [card.id, card]));
  for (const start of byId.keys()) {
    const seen = new Set<string>();
    let id: string | undefined = start;
    while (id !== undefined && byId.has(id) && !seen.has(id)) {
      seen.add(id);
      if (seen.size > MAX_LOADED_ANCESTORS + 1) { throw new Error(HIERARCHY_DEPTH_ERROR); }
      id = byId.get(id)?.parent?.id;
    }
  }
}

interface RefreshRequest {
  generation: number;
  promise: Promise<void>;
  resolve: () => void;
}

const views: View[] = ['tree', 'table', 'kanban'];
const columnStatuses = ['open', 'in_progress', 'blocked', 'deferred', 'closed'];
const universe = (known: readonly string[], values: string[]): string[] =>
  [...known, ...[...new Set(values)].filter(value => !known.includes(value)).sort()];
const sameSet = (a: string[], b: readonly string[]): boolean =>
  a.length === b.length && a.every(value => b.includes(value));
const defaults = (types: string[]): Filters => ({
  search: '', statuses: [...STATUS_ACTIVE_VALUES], priorities: [...PRIORITY_ALL_VALUES], types: [...types],
});
const errorText = (error: unknown): string => error instanceof Error ? error.message : String(error);
function freeze<T>(value: T): T {
  if (value && typeof value === 'object' && !Object.isFrozen(value)) {
    for (const child of Object.values(value)) { freeze(child); }
    Object.freeze(value);
  }
  return value;
}

export class BrowserController {
  private state: BrowserState = freeze({
    cards: [], view: 'tree', filters: defaults([...TYPE_ALL_VALUES]), selectedId: null,
    expanded: {}, viewports: { tree: 0, table: 0, kanban: 0 }, columnOffsets: {}, kanbanColumn: 0,
    loading: false, stale: false, error: null, truncated: false, lastRefresh: null,
    detail: null, detailLoading: false, detailError: null,
  });
  private listeners = new Set<() => void>();
  private disposed = false;
  private generation = 0;
  private activeRefresh: RefreshRequest | null = null;
  private pendingRefresh: RefreshRequest | null = null;
  private defaultTypes = true;
  private cache = new Map<string, FullCard>();
  private detailErrors = new Map<string, string>();
  private active: { id: string; generation: number } | null = null;
  private pending: { id: string; generation: number } | null = null;
  private reveal = new Set<string>();
  private base: {
    cards: EnrichedCard[]; filters: Filters; matching: EnrichedCard[];
    roots: TreeNode[]; parents: Map<string, string>; byId: Map<string, EnrichedCard>;
    columns: Projection['columns']; statuses: string[]; types: string[];
  } | null = null;
  private projection: Projection | null = null;
  private projectedBase: typeof this.base = null;
  private projectedExpansion: BrowserState['expanded'] | null = null;
  private projectedReveal: Set<string> | null = null;

  constructor(private readonly service: ReadService, private readonly limit: number = 1000) {
    if (!Number.isInteger(limit) || limit < 1 || limit > 5000) {
      throw new RangeError('Snapshot limit must be an integer from 1 to 5000');
    }
  }

  getState(): BrowserState { return this.state; }

  subscribe(listener: () => void): () => void {
    if (!this.disposed) { this.listeners.add(listener); }
    return () => { this.listeners.delete(listener); };
  }

  private publish(patch: Partial<BrowserState>): void {
    if (this.disposed) { return; }
    this.state = freeze({ ...this.state, ...patch });
    for (const listener of this.listeners) { listener(); }
  }

  private getBase(state = this.state) {
    const { cards, filters } = state;
    if (this.base?.cards === cards && this.base.filters === filters) { return this.base; }
    const statuses = universe(STATUS_ALL_VALUES, cards.map(card => card.status));
    const types = universe(TYPE_ALL_VALUES, cards.map(card => card.issue_type));
    const search = filters.search.trim().toLowerCase();
    const matchingIds = new Set(cards.filter(card =>
      filters.statuses.includes(card.status) && filters.priorities.includes(String(card.priority))
      && filters.types.includes(card.issue_type)
      && (!search || [card.id, card.title, card.description, ...(card.labels ?? [])]
        .some(text => text.toLowerCase().includes(search))),
    ).map(card => card.id));
    const byId = new Map(cards.map(card => [card.id, card]));
    const matching = buildDisplayTree(cards.map(card => ({ ...card, parent: undefined })), matchingIds, DEFAULT_TREE_SORT)
      .map(node => byId.get(node.id)!);
    const roots = buildDisplayTree(cards, matchingIds, DEFAULT_TREE_SORT);
    const parents = new Map<string, string>();
    const visit = (node: TreeNode): void => {
      for (const child of node.children) { parents.set(child.id, node.id); visit(child); }
    };
    roots.forEach(visit);
    const columns = universe(columnStatuses, cards.map(card => card.status))
      .map(status => ({ status, cards: matching.filter(card => card.status === status) }));
    this.base = { cards, filters, matching, roots, parents, byId, columns, statuses, types };
    return this.base;
  }

  project(): Projection {
    return this.projectState(this.state, this.reveal);
  }

  private projectState(state: BrowserState, reveal: Set<string>): Projection {
    const base = this.getBase(state);
    if (this.projection && this.projectedBase === base && this.projectedExpansion === state.expanded
      && this.projectedReveal === reveal) { return this.projection; }
    const { filters, expanded } = state;
    const filterActive = Boolean(filters.search.trim()) || !sameSet(filters.statuses, STATUS_ACTIVE_VALUES)
      || !sameSet(filters.priorities, PRIORITY_ALL_VALUES) || !sameSet(filters.types, base.types);
    const rows = flattenVisibleRows(base.roots,
      (id, depth) => reveal.has(id) || (expanded[id] ?? defaultExpanded(depth)), filterActive)
      .map(row => {
        const card = base.byId.get(row.id)!;
        return { ...row, card, parentNotLoaded: Boolean(card.parent && !base.byId.has(card.parent.id)) };
      });
    this.projectedBase = base;
    this.projectedExpansion = expanded;
    this.projectedReveal = reveal;
    this.projection = freeze({ matching: base.matching, rows, columns: base.columns, statuses: base.statuses, types: base.types });
    return this.projection;
  }

  private ids(): string[] {
    const projection = this.project();
    return this.state.view === 'tree' ? projection.rows.map(row => row.card.id)
      : projection.matching.map(card => card.id);
  }

  private reconcile(previous: string[], selectedId = this.state.selectedId): void {
    const candidate = this.reconciled(this.state, previous, selectedId);
    this.state = candidate.state;
    this.reveal = candidate.reveal;
  }

  private reconciled(state: BrowserState, previous: string[], selectedId = state.selectedId) {
    const base = this.getBase(state);
    const reveal = new Set<string>();
    if (state.view === 'tree' && selectedId) {
      let parent = base.parents.get(selectedId);
      while (parent) { reveal.add(parent); parent = base.parents.get(parent); }
    }
    const projection = this.projectState(state, reveal);
    const ids = state.view === 'tree' ? projection.rows.map(row => row.card.id) : projection.matching.map(card => card.id);
    if (!selectedId || !ids.includes(selectedId)) {
      const index = selectedId ? Math.max(0, previous.indexOf(selectedId)) : 0;
      selectedId = ids[Math.min(index, ids.length - 1)] ?? null;
    }
    const column = base.columns.findIndex(item => item.cards.some(card => card.id === selectedId));
    return { state: freeze({ ...state, selectedId,
      kanbanColumn: column >= 0 ? column : Math.min(state.kanbanColumn, base.columns.length - 1) }), reveal };
  }

  refresh(): Promise<void> {
    if (this.disposed) { return Promise.resolve(); }
    const generation = ++this.generation;
    if (this.pendingRefresh) {
      this.pendingRefresh.generation = generation;
    } else {
      let resolve!: () => void;
      const promise = new Promise<void>(done => { resolve = done; });
      this.pendingRefresh = { generation, promise, resolve };
    }
    const promise = this.pendingRefresh.promise;
    this.cache.clear();
    this.detailErrors.clear();
    this.pending = null;
    this.publish({ loading: true, error: null, detail: null, detailError: null, detailLoading: false });
    this.pumpRefresh();
    return promise;
  }

  private pumpRefresh(): void {
    if (this.disposed || this.activeRefresh || !this.pendingRefresh) { return; }
    const request = this.pendingRefresh;
    this.pendingRefresh = null;
    this.activeRefresh = request;
    void this.fetchSnapshot(request);
  }

  private async fetchSnapshot(request: RefreshRequest): Promise<void> {
    const { generation } = request;
    try {
      const result = await this.service.list(this.limit + 1);
      if (this.disposed || generation !== this.generation) { return; }
      const previous = this.ids();
      const cards = freeze(structuredClone(result.slice(0, this.limit)));
      validateDepth(cards);
      const types = universe(TYPE_ALL_VALUES, cards.map(card => card.issue_type));
      const loadedIds = new Set(cards.map(card => card.id));
      const expanded = Object.fromEntries(Object.entries(this.state.expanded).filter(([id]) => loadedIds.has(id)));
      const state = freeze({ ...this.state, cards, expanded,
        filters: this.defaultTypes ? { ...this.state.filters, types } : this.state.filters,
        loading: false, stale: false, error: null, truncated: result.length > this.limit, lastRefresh: Date.now() });
      const candidate = this.reconciled(state, previous);
      this.state = candidate.state;
      this.reveal = candidate.reveal;
      this.loadSelected();
    } catch (error) {
      if (this.disposed || generation !== this.generation) { return; }
      this.state = freeze({ ...this.state, loading: false, stale: true, error: errorText(error) });
      this.loadSelected();
    } finally {
      this.activeRefresh = null;
      request.resolve();
      this.pumpRefresh();
    }
  }

  setView(view: View): void {
    if (this.disposed || this.state.view === view) { return; }
    const previous = this.ids();
    this.state = freeze({ ...this.state, view });
    this.reconcile(previous);
    this.loadSelected();
  }

  cycleView(): void { this.setView(views[(views.indexOf(this.state.view) + 1) % views.length]); }

  setFilters(partial: Partial<Filters>): void {
    if (this.disposed) { return; }
    const previous = this.ids();
    if (partial.types !== undefined) { this.defaultTypes = sameSet(partial.types, this.getBase().types); }
    this.state = freeze({ ...this.state, filters: structuredClone({ ...this.state.filters, ...partial }) });
    this.reconcile(previous);
    this.loadSelected();
  }

  resetFilters(): void {
    if (this.disposed) { return; }
    this.defaultTypes = true;
    this.setFilters(defaults(this.getBase().types));
  }

  select(id: string | null): void {
    if (this.disposed || (id !== null && !this.ids().includes(id))) { return; }
    const column = this.project().columns.findIndex(item => item.cards.some(card => card.id === id));
    this.state = freeze({ ...this.state, selectedId: id, kanbanColumn: column >= 0 ? column : this.state.kanbanColumn });
    this.loadSelected();
  }

  move(delta: number): void {
    if (this.disposed || !Number.isFinite(delta) || delta === 0) { return; }
    const ids = this.state.view === 'kanban'
      ? this.project().columns[this.state.kanbanColumn].cards.map(card => card.id) : this.ids();
    const current = ids.indexOf(this.state.selectedId ?? '');
    const index = current < 0 ? (delta > 0 ? 0 : ids.length - 1) : Math.max(0, Math.min(ids.length - 1, current + Math.trunc(delta)));
    this.select(ids[index] ?? null);
  }

  horizontal(delta: -1 | 1): void {
    if (this.disposed) { return; }
    const projection = this.project();
    if (this.state.view === 'kanban') {
      const column = Math.max(0, Math.min(projection.columns.length - 1, this.state.kanbanColumn + delta));
      if (column === this.state.kanbanColumn) { return; }
      const index = projection.columns[this.state.kanbanColumn].cards.findIndex(card => card.id === this.state.selectedId);
      const cards = projection.columns[column].cards;
      this.state = freeze({ ...this.state, kanbanColumn: column,
        selectedId: cards[Math.min(Math.max(0, index), cards.length - 1)]?.id ?? null });
      this.loadSelected();
    } else if (this.state.view === 'tree') {
      const index = projection.rows.findIndex(row => row.card.id === this.state.selectedId);
      const row = projection.rows[index];
      if (!row) { return; }
      if (delta === 1) {
        if (row.hasChildren && !row.expanded) { this.toggle(); }
        else if (row.hasChildren) { this.select(projection.rows[index + 1].card.id); }
      } else if (row.hasChildren && row.expanded) { this.toggle(); }
      else { const parent = this.getBase().parents.get(row.card.id); if (parent) { this.select(parent); } }
    }
  }

  toggle(): void {
    if (this.disposed || this.state.view !== 'tree') { return; }
    const row = this.project().rows.find(item => item.card.id === this.state.selectedId);
    if (!row?.hasChildren) { return; }
    const parents = this.getBase().parents;
    this.reveal = new Set([...this.reveal].filter(id => {
      let ancestor: string | undefined = id;
      while (ancestor) {
        if (ancestor === row.card.id) { return false; }
        ancestor = parents.get(ancestor);
      }
      return true;
    }));
    this.publish({ expanded: { ...this.state.expanded, [row.card.id]: !row.expanded } });
  }

  setViewport(view: View, offset: number): void {
    if (Number.isFinite(offset)) { this.publish({ viewports: { ...this.state.viewports, [view]: Math.max(0, Math.trunc(offset)) } }); }
  }

  setColumnOffset(status: string, offset: number): void {
    if (Number.isFinite(offset)) { this.publish({ columnOffsets: { ...this.state.columnOffsets, [status]: Math.max(0, Math.trunc(offset)) } }); }
  }

  private loadSelected(): void {
    const id = this.state.selectedId;
    this.pending = null;
    if (!id || this.state.loading) {
      this.publish({ detail: null, detailLoading: false, detailError: null });
      return;
    }
    const detail = this.cache.get(id);
    if (detail) { this.publish({ detail, detailLoading: false, detailError: null }); return; }
    const detailError = this.detailErrors.get(id);
    if (detailError !== undefined) { this.publish({ detail: null, detailLoading: false, detailError }); return; }
    const request = { id, generation: this.generation };
    if (this.active?.id !== id || this.active.generation !== this.generation) { this.pending = request; }
    this.publish({ detail: null, detailLoading: true, detailError: null });
    this.pump();
  }

  private pump(): void {
    if (this.disposed || this.active || !this.pending) { return; }
    const request = this.pending;
    this.pending = null;
    this.active = request;
    void this.fetchDetail(request);
  }

  private async fetchDetail(request: { id: string; generation: number }): Promise<void> {
    try {
      const result = await this.service.detail(request.id);
      if (this.disposed || request.generation !== this.generation) { return; }
      const detail = freeze(structuredClone(result));
      this.cache.set(request.id, detail);
      if (this.state.selectedId === request.id) { this.publish({ detail, detailLoading: false, detailError: null }); }
    } catch (error) {
      if (!this.disposed && request.generation === this.generation) {
        this.detailErrors.set(request.id, errorText(error));
        if (this.state.selectedId === request.id) {
          this.publish({ detail: null, detailLoading: false, detailError: errorText(error) });
        }
      }
    } finally {
      this.active = null;
      this.pump();
    }
  }

  dispose(): void {
    if (this.disposed) { return; }
    this.disposed = true;
    this.generation++;
    this.activeRefresh?.resolve();
    this.pendingRefresh?.resolve();
    this.pendingRefresh = null;
    this.pending = null;
    this.cache.clear();
    this.detailErrors.clear();
    this.listeners.clear();
    this.service.dispose();
  }
}
