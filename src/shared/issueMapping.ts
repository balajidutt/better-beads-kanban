import { Comment, DependencyInfo, EnrichedCard, FullCard } from './issueTypes';

export function readBoolFromMetadata(issue: Record<string, unknown>, key: string): boolean {
  const metadata = issue.metadata as Record<string, unknown> | undefined;
  const candidate = metadata?.[key] ?? issue[key];
  if (candidate === true || candidate === 1) { return true; }
  if (typeof candidate === 'string') {
    const v = candidate.toLowerCase();
    return v === 'true' || v === '1';
  }
  return false;
}

function mapBase(issue: Record<string, unknown>): EnrichedCard {
  return {
    id: issue.id as string,
    title: (issue.title as string) || '',
    description: (issue.description as string) || '',
    status: (issue.status as string) || 'open',
    priority: typeof issue.priority === 'number' ? issue.priority : 2,
    issue_type: (issue.issue_type as string) || 'task',
    created_at: (issue.created_at as string) || new Date().toISOString(),
    created_by: (issue.created_by as string) || 'unknown',
    updated_at: (issue.updated_at as string) || (issue.created_at as string) || new Date().toISOString(),
    closed_at: (issue.closed_at as string | null) || null,
    close_reason: (issue.close_reason as string | null) || null,
    dependency_count: (issue.dependency_count as number) || 0,
    dependent_count: (issue.dependent_count as number) || 0,
    assignee: (issue.assignee as string | null) || null,
    estimated_minutes: (issue.estimated_minutes as number | null) || null,
    external_ref: (issue.external_ref as string | null) || null,
    pinned: readBoolFromMetadata(issue, 'pinned')
  };
}

export function mapBdListIssuesToEnrichedCards(issuesRaw: unknown[]): EnrichedCard[] {
  const issues = issuesRaw as Record<string, unknown>[];
  const issueById = new Map<string, Record<string, unknown>>();
  for (const issue of issues) {
    if (typeof issue.id === 'string') { issueById.set(issue.id, issue); }
  }
  const makeRef = (id: string): DependencyInfo => {
    const ref = issueById.get(id);
    return {
      id, title: (ref?.title as string) || id,
      created_at: ref?.created_at as string | undefined,
      created_by: (ref?.created_by as string) || 'unknown'
    };
  };
  const childrenByParentId = new Map<string, DependencyInfo[]>();
  const blocksByBlockerId = new Map<string, DependencyInfo[]>();
  for (const issue of issues) {
    if (!Array.isArray(issue.dependencies)) { continue; }
    for (const d of issue.dependencies) {
      const dep = d as Record<string, unknown>;
      const sourceId = dep.issue_id as string | undefined;
      const targetId = dep.depends_on_id as string | undefined;
      if (!sourceId || !targetId) { continue; }
      const index = dep.type === 'parent-child' ? childrenByParentId : dep.type === 'blocks' ? blocksByBlockerId : undefined;
      if (index) {
        const refs = index.get(targetId) || [];
        refs.push(makeRef(sourceId));
        index.set(targetId, refs);
      }
    }
  }
  return issues.map(issue => {
    const id = issue.id as string;
    let parentId: string | undefined;
    if (typeof issue.parent === 'string' && issue.parent.length > 0) {
      parentId = issue.parent;
    } else if (Array.isArray(issue.dependencies)) {
      for (const d of issue.dependencies) {
        const dep = d as Record<string, unknown>;
        if (dep.type === 'parent-child' && typeof dep.depends_on_id === 'string' && dep.depends_on_id !== id) {
          parentId = dep.depends_on_id;
          break;
        }
      }
    }
    const blockedBy: DependencyInfo[] = [];
    if (Array.isArray(issue.dependencies)) {
      for (const d of issue.dependencies) {
        const dep = d as Record<string, unknown>;
        if (dep.type === 'blocks' && typeof dep.depends_on_id === 'string' && dep.depends_on_id !== id) {
          blockedBy.push(makeRef(dep.depends_on_id));
        }
      }
    }
    const children = childrenByParentId.get(id);
    const blocks = blocksByBlockerId.get(id);
    return {
      ...mapBase(issue),
      labels: Array.isArray(issue.labels) ? issue.labels as string[] : [],
      blocked_by_count: (issue.blocked_by_count as number) || 0,
      is_ready: issue.status === 'open' && ((issue.blocked_by_count as number) || 0) === 0,
      parent: parentId ? makeRef(parentId) : undefined,
      children: children && children.length > 0 ? children : undefined,
      blocked_by: blockedBy.length > 0 ? blockedBy : undefined,
      blocks: blocks && blocks.length > 0 ? blocks : undefined
    };
  });
}

function dependencyRef(dep: Record<string, unknown>): DependencyInfo {
  return {
    id: dep.id as string, title: dep.title as string, created_at: dep.created_at as string,
    created_by: (dep.created_by as string) || 'unknown',
    metadata: dep.metadata as string | undefined, thread_id: dep.thread_id as string | undefined
  };
}

export function extractParentDependency(issue: Record<string, unknown>): DependencyInfo | undefined {
  if (!Array.isArray(issue.dependencies)) { return undefined; }
  for (const d of issue.dependencies) {
    const dep = d as Record<string, unknown>;
    if (dep.dependency_type === 'parent-child' && dep.id !== issue.id) { return dependencyRef(dep); }
  }
  return undefined;
}

function extractDependencies(issue: Record<string, unknown>, field: string, type: string): DependencyInfo[] {
  const refs: DependencyInfo[] = [];
  const values = issue[field];
  if (!Array.isArray(values)) { return refs; }
  for (const d of values) {
    const dep = d as Record<string, unknown>;
    if (dep.dependency_type === type && dep.id !== issue.id) { refs.push(dependencyRef(dep)); }
  }
  return refs;
}

export function extractChildrenDependencies(issue: Record<string, unknown>): DependencyInfo[] {
  return extractDependencies(issue, 'dependents', 'parent-child');
}

export function extractBlocksDependencies(issue: Record<string, unknown>): DependencyInfo[] {
  return extractDependencies(issue, 'dependents', 'blocks');
}

export function extractBlockedByDependencies(issue: Record<string, unknown>): DependencyInfo[] {
  return extractDependencies(issue, 'dependencies', 'blocks');
}

export function mapBdShowIssueToFullCard(issue: Record<string, unknown>, issueId: string): FullCard {
  const parent = extractParentDependency(issue);
  const children = extractChildrenDependencies(issue);
  const blocks = extractBlocksDependencies(issue);
  const blocked_by = extractBlockedByDependencies(issue);
  const labels = Array.isArray(issue.labels)
    ? issue.labels.map((label: unknown) => typeof label === 'string' ? label : (label as { label: string }).label) : [];
  const comments: Comment[] = Array.isArray(issue.comments) ? issue.comments.map((c: unknown) => {
    const comment = c as Record<string, unknown>;
    return {
      id: typeof comment.id === 'string' ? parseInt(comment.id, 10) : (comment.id as number),
      issue_id: issueId, author: (comment.author as string) || 'unknown',
      text: (comment.text as string) || '', created_at: comment.created_at as string
    };
  }) : [];
  return {
    ...mapBase(issue), labels, blocked_by_count: blocked_by.length,
    acceptance_criteria: (issue.acceptance_criteria as string) || '',
    design: (issue.design as string) || '', notes: (issue.notes as string) || '',
    due_at: (issue.due_at as string | null) || null,
    defer_until: (issue.defer_until as string | null) || null,
    is_ready: issue.status === 'open' && blocked_by.length === 0,
    is_template: readBoolFromMetadata(issue, 'template'),
    ephemeral: issue.ephemeral === 1 || issue.ephemeral === true,
    event_kind: (issue.event_kind as string | null) || null,
    actor: (issue.actor as string | null) || null,
    target: (issue.target as string | null) || null,
    payload: (issue.payload as string | null) || null,
    sender: (issue.sender as string | null) || null,
    mol_type: (issue.mol_type as string | null) || null,
    role_type: (issue.role_type as string | null) || null,
    rig: (issue.rig as string | null) || null,
    agent_state: (issue.agent_state as string | null) || null,
    last_activity: (issue.last_activity as string | null) || null,
    hook_bead: (issue.hook_bead as string | null) || null,
    role_bead: (issue.role_bead as string | null) || null,
    await_type: (issue.await_type as string | null) || null,
    await_id: (issue.await_id as string | null) || null,
    timeout_ns: (issue.timeout_ns as number | null) || null,
    waiters: (issue.waiters as string | null) || null,
    parent, children, blocks, blocked_by, comments
  };
}
