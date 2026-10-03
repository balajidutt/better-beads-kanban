/**
 * Pure helper for the claim-lease text bd 1.3 attaches to in-progress issues.
 * Free of DOM access and of the `vscode` API so it can be unit-tested directly.
 */

export interface LeaseLike {
  status?: string;
  lease_expires_at?: string;
}

export interface LeaseState {
  text: string;
  expired: boolean;
  expiresAt: string;
}

/** Lease state for an in-progress card, or null when it has no lease to show. */
export function leaseState(card: LeaseLike, nowMs: number): LeaseState | null {
  if (card.status !== 'in_progress' || typeof card.lease_expires_at !== 'string') { return null; }
  const expiresMs = Date.parse(card.lease_expires_at);
  if (Number.isNaN(expiresMs)) { return null; }
  const remainingMs = expiresMs - nowMs;
  if (remainingMs <= 0) {
    return { text: 'lease expired', expired: true, expiresAt: card.lease_expires_at };
  }
  const minutes = Math.ceil(remainingMs / 60000);
  const text = minutes < 60
    ? `lease ${minutes}m`
    : `lease ${Math.floor(minutes / 60)}h${minutes % 60 ? ` ${minutes % 60}m` : ''}`;
  return { text, expired: false, expiresAt: card.lease_expires_at };
}

export interface AssigneeBadge {
  text: string;
  cls: string;
  title?: string;
}

/** The card's assignee badge, with the lease state appended while one applies. */
export function assigneeBadge(card: LeaseLike & { assignee?: string | null }, nowMs: number): AssigneeBadge {
  if (!card.assignee) { return { text: 'Assignee: Unassigned', cls: 'badge-assignee badge-unassigned' }; }
  const lease = leaseState(card, nowMs);
  if (!lease) { return { text: `Assignee: ${card.assignee}`, cls: 'badge-assignee' }; }
  return {
    text: `Assignee: ${card.assignee} · ${lease.text}`,
    cls: lease.expired ? 'badge-assignee badge-lease-expired' : 'badge-assignee',
    title: `Lease ${lease.expired ? 'expired' : 'expires'} ${new Date(lease.expiresAt).toLocaleString()}`
  };
}

export interface LeaseActionContext {
  readOnly: boolean;
  leases: boolean;
  isCreateMode: boolean;
}

export interface LeaseActionVisibility {
  row: boolean;
  claim: boolean;
  unclaim: boolean;
  heartbeat: boolean;
}

/** Which claim-lease actions the detail dialog offers for a card. */
export function leaseActionVisibility(
  card: LeaseLike & { assignee?: string | null },
  context: LeaseActionContext
): LeaseActionVisibility {
  const enabled = context.leases && !context.readOnly && !context.isCreateMode;
  const claim = enabled && !card.assignee && card.status === 'open';
  const unclaim = enabled && !!card.assignee && card.status === 'in_progress';
  const heartbeat = enabled && card.status === 'in_progress' && typeof card.lease_expires_at === 'string';
  return { row: claim || unclaim || heartbeat, claim, unclaim, heartbeat };
}
