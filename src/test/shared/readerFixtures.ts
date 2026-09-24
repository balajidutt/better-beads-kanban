export const FIXED_TIME = '2026-01-02T03:04:05.000Z';

export const defaultCard = {
  id: 'test-empty', title: '', description: '', status: 'open', priority: 2,
  issue_type: 'task', created_at: FIXED_TIME, created_by: 'unknown', updated_at: FIXED_TIME,
  closed_at: null, close_reason: null, dependency_count: 0, dependent_count: 0,
  assignee: null, estimated_minutes: null, labels: [], external_ref: null, pinned: false,
  blocked_by_count: 0, is_ready: false, parent: undefined, children: undefined,
  blocked_by: undefined, blocks: undefined
};

export const defaultFullCard = {
  ...defaultCard, acceptance_criteria: '', design: '', notes: '', due_at: null,
  defer_until: null, is_template: false, ephemeral: false, event_kind: null, actor: null,
  target: null, payload: null, sender: null, mol_type: null, role_type: null, rig: null,
  agent_state: null, last_activity: null, hook_bead: null, role_bead: null,
  await_type: null, await_id: null, timeout_ns: null, waiters: null,
  children: [], blocks: [], blocked_by: [], comments: []
};

export const listFixture = [
  { id: 'test-parent', title: 'Parent', status: 'open', created_at: 'yesterday' },
  { id: 'test-child', parent: 'test-parent', labels: ['one'], estimated_minutes: 0,
    metadata: { pinned: 'TRUE' }, dependencies: [
      { issue_id: 'test-child', depends_on_id: 'test-other', type: 'parent-child' },
      { issue_id: 'test-child', depends_on_id: 'test-parent', type: 'blocks' }
    ] },
  { id: 'test-other' }
];

export const showFixture = {
  id: 'test-child', status: 'open', parent: 'test-ignored', blocked_by_count: 99,
  labels: ['one', { label: 'two' }], comments: [{ id: '12x', text: 'hello', created_at: 'then' }],
  metadata: { pinned: false, template: '1' }, pinned: true, ephemeral: '1',
  estimated_minutes: 0, timeout_ns: 0, actor: 'agent',
  dependencies: [
    { id: 'test-child', dependency_type: 'blocks' },
    { id: 'test-parent', title: 'Parent', dependency_type: 'parent-child', metadata: 'meta', thread_id: 'thread' },
    { id: 'test-blocker', title: 'Blocker', dependency_type: 'blocks' }
  ],
  dependents: [
    { id: 'test-descendant', title: 'Descendant', dependency_type: 'parent-child' },
    { id: 'test-blocked', title: 'Blocked', dependency_type: 'blocks' }
  ]
};

export const showRef = (id: string, title: string) => ({
  id, title, created_at: undefined, created_by: 'unknown', metadata: undefined, thread_id: undefined
});

export const expectedShowCard = {
  ...defaultFullCard, id: 'test-child', labels: ['one', 'two'], blocked_by_count: 1,
  is_template: true, actor: 'agent',
  parent: { ...showRef('test-parent', 'Parent'), metadata: 'meta', thread_id: 'thread' },
  children: [showRef('test-descendant', 'Descendant')],
  blocks: [showRef('test-blocked', 'Blocked')],
  blocked_by: [showRef('test-blocker', 'Blocker')],
  comments: [{ id: 12, issue_id: 'test-child', author: 'unknown', text: 'hello', created_at: 'then' }]
};
