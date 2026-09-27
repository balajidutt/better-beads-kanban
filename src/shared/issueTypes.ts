export type IssueStatus = "open" | "in_progress" | "blocked" | "closed";

export interface MinimalCard {
  id: string;
  title: string;
  description: string;
  status: string;
  priority: number;
  issue_type: string;
  created_at: string;
  created_by: string;
  updated_at: string;
  closed_at?: string | null;
  close_reason?: string | null;
  dependency_count: number;
  dependent_count: number;
}

export interface EnrichedCard extends MinimalCard {
  assignee?: string | null;
  estimated_minutes?: number | null;
  labels?: string[];
  external_ref?: string | null;
  pinned?: boolean;
  blocked_by_count?: number;
  is_ready?: boolean;
  parent?: DependencyInfo;
  children?: DependencyInfo[];
  blocks?: DependencyInfo[];
  blocked_by?: DependencyInfo[];
}

export interface FullCard extends EnrichedCard {
  acceptance_criteria: string;
  design: string;
  notes: string;
  due_at?: string | null;
  defer_until?: string | null;
  is_ready?: boolean;
  is_template?: boolean;
  ephemeral?: boolean;
  event_kind?: string | null;
  actor?: string | null;
  target?: string | null;
  payload?: string | null;
  sender?: string | null;
  mol_type?: string | null;
  role_type?: string | null;
  rig?: string | null;
  agent_state?: string | null;
  last_activity?: string | null;
  hook_bead?: string | null;
  role_bead?: string | null;
  await_type?: string | null;
  await_id?: string | null;
  timeout_ns?: number | null;
  waiters?: string | null;
  parent?: DependencyInfo;
  children?: DependencyInfo[];
  blocks?: DependencyInfo[];
  blocked_by?: DependencyInfo[];
  comments?: Comment[];
}

export interface DependencyInfo {
  id: string;
  title: string;
  created_at?: string;
  created_by?: string;
  metadata?: string;
  thread_id?: string;
}

export interface Comment {
  id: number;
  issue_id: string;
  author: string;
  text: string;
  created_at: string;
}

export const ISSUE_ID_PATTERN = /^([a-z0-9]+([._-][a-z0-9]+)*\.)?[a-z0-9]+-[a-z0-9]+([._-][a-z0-9]+)*$/i;

export function validateIssueId(issueId: string): void {
  if (typeof issueId !== 'string' || !issueId) {
    throw new Error('Issue ID must be a non-empty string');
  }
  if (issueId.startsWith('-')) {
    throw new Error(`Invalid issue ID: cannot start with hyphen (${issueId})`);
  }
  if (issueId.includes(' ') || issueId.includes('\t') || issueId.includes('\n') || issueId.includes('\r')) {
    throw new Error(`Invalid issue ID: whitespace not allowed (${issueId})`);
  }
  if (!ISSUE_ID_PATTERN.test(issueId)) {
    throw new Error(`Invalid issue ID format: ${issueId}. Expected format: prefix-xxxx or project.prefix-xxxx`);
  }
  if (/[;&|`$(){}[\]<>\\'"]/.test(issueId)) {
    throw new Error(`Invalid issue ID: contains dangerous characters (${issueId})`);
  }
}
