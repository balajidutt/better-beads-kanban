import type { EnrichedCard, FullCard } from '../../src/shared/model';

export type View = 'tree' | 'table' | 'kanban';
export interface Filters {
  search: string;
  statuses: string[];
  priorities: string[];
  types: string[];
}
export interface ReadService {
  list(limit: number): Promise<EnrichedCard[]>;
  detail(id: string): Promise<FullCard>;
  dispose(): void;
}
export interface BrowserState {
  cards: EnrichedCard[];
  view: View;
  filters: Filters;
  selectedId: string | null;
  expanded: Record<string, boolean>;
  viewports: Record<View, number>;
  columnOffsets: Record<string, number>;
  kanbanColumn: number;
  loading: boolean;
  stale: boolean;
  error: string | null;
  truncated: boolean;
  lastRefresh: number | null;
  detail: FullCard | null;
  detailLoading: boolean;
  detailError: string | null;
}
export interface DisplayRow {
  card: EnrichedCard;
  depth: number;
  guides: boolean[];
  isLast: boolean;
  hasChildren: boolean;
  expanded: boolean;
  matches: boolean;
  parentNotLoaded: boolean;
}
export interface Projection {
  matching: EnrichedCard[];
  rows: DisplayRow[];
  columns: { status: string; cards: EnrichedCard[] }[];
  statuses: string[];
  types: string[];
}
