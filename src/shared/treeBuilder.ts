export interface TreeCardInput {
  id: string;
  title?: string;
  parent?: { id: string; title?: string } | null;
  updated_at?: string;
  created_at?: string;
  priority?: number;
}

export interface TreeSortSpec {
  id: 'updated_at' | 'priority' | 'title' | 'created_at';
  dir: 'asc' | 'desc';
}

export const DEFAULT_TREE_SORT: TreeSortSpec = { id: 'updated_at', dir: 'desc' };

export interface TreeNode {
  id: string;
  depth: number;
  matches: boolean;
  descendantMatch: boolean;
  children: TreeNode[];
}

export interface TreeRow {
  id: string;
  depth: number;
  guides: boolean[];
  isLast: boolean;
  hasChildren: boolean;
  expanded: boolean;
  matches: boolean;
}

export function defaultExpanded(depth: number): boolean {
  return depth === 0;
}

function resolveParents(byId: Map<string, TreeCardInput>): Map<string, string | undefined> {
  const rawParent = (id: string): string | undefined => {
    const p = byId.get(id)?.parent?.id;
    return p && p !== id && byId.has(p) ? p : undefined;
  };

  const severed = new Set<string>();
  const resolved = new Set<string>();
  const sortedIds = [...byId.keys()].sort();
  for (const start of sortedIds) {
    if (resolved.has(start)) { continue; }
    const chain: string[] = [];
    const chainSet = new Set<string>();
    let cur: string | undefined = start;
    while (cur !== undefined && !resolved.has(cur)) {
      if (chainSet.has(cur)) {
        severed.add(chain[chain.length - 1]);
        break;
      }
      chain.push(cur);
      chainSet.add(cur);
      cur = severed.has(cur) ? undefined : rawParent(cur);
    }
    for (const id of chain) { resolved.add(id); }
  }

  const effective = new Map<string, string | undefined>();
  for (const id of byId.keys()) {
    effective.set(id, severed.has(id) ? undefined : rawParent(id));
  }
  return effective;
}

function makeComparator(
  byId: Map<string, TreeCardInput>,
  sort: TreeSortSpec
): (a: string, b: string) => number {
  const dirMul = sort.dir === 'asc' ? 1 : -1;
  return (aId, bId) => {
    const a = byId.get(aId);
    const b = byId.get(bId);
    let cmp = 0;
    switch (sort.id) {
      case 'priority':
        cmp = (a?.priority ?? 2) - (b?.priority ?? 2);
        break;
      case 'title':
        cmp = (a?.title || '').toLowerCase().localeCompare((b?.title || '').toLowerCase());
        break;
      case 'created_at':
        cmp = new Date(a?.created_at || 0).getTime() - new Date(b?.created_at || 0).getTime();
        break;
      case 'updated_at':
      default:
        cmp = new Date(a?.updated_at || 0).getTime() - new Date(b?.updated_at || 0).getTime();
        break;
    }
    if (cmp !== 0) { return cmp * dirMul; }
    return aId < bId ? -1 : aId > bId ? 1 : 0;
  };
}

export function buildDisplayTree(
  cards: readonly TreeCardInput[],
  matchedIds: ReadonlySet<string>,
  sort: TreeSortSpec
): TreeNode[] {
  const byId = new Map<string, TreeCardInput>();
  for (const card of cards) {
    if (card && typeof card.id === 'string' && card.id.length > 0) {
      byId.set(card.id, card);
    }
  }
  const parentOf = resolveParents(byId);

  const displayed = new Set<string>();
  for (const id of matchedIds) {
    let cur: string | undefined = id;
    while (cur !== undefined && byId.has(cur) && !displayed.has(cur)) {
      displayed.add(cur);
      cur = parentOf.get(cur);
    }
  }

  const childIds = new Map<string | undefined, string[]>();
  for (const id of displayed) {
    const parent = parentOf.get(id);
    const key = parent !== undefined && displayed.has(parent) ? parent : undefined;
    const list = childIds.get(key);
    if (list) { list.push(id); } else { childIds.set(key, [id]); }
  }

  const comparator = makeComparator(byId, sort);
  const build = (id: string, depth: number): TreeNode => {
    const kids = (childIds.get(id) || []).sort(comparator).map(k => build(k, depth + 1));
    return {
      id,
      depth,
      matches: matchedIds.has(id),
      descendantMatch: kids.some(k => k.matches || k.descendantMatch),
      children: kids
    };
  };
  return (childIds.get(undefined) || []).sort(comparator).map(id => build(id, 0));
}

export function flattenVisibleRows(
  roots: readonly TreeNode[],
  isExpanded: (id: string, depth: number) => boolean,
  filterActive: boolean
): TreeRow[] {
  const rows: TreeRow[] = [];
  const walk = (node: TreeNode, guides: boolean[], isLast: boolean): void => {
    const expanded = node.children.length > 0
      && (isExpanded(node.id, node.depth) || (filterActive && node.descendantMatch));
    rows.push({
      id: node.id,
      depth: node.depth,
      guides,
      isLast,
      hasChildren: node.children.length > 0,
      expanded,
      matches: node.matches
    });
    if (!expanded) { return; }
    const childGuides = node.depth === 0 ? [] : [...guides, !isLast];
    node.children.forEach((child, i) => {
      walk(child, childGuides, i === node.children.length - 1);
    });
  };
  roots.forEach((root, i) => walk(root, [], i === roots.length - 1));
  return rows;
}
