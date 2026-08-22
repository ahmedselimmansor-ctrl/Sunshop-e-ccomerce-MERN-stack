import { AuditLog } from '../models/AuditLog';
import { getContext } from '../observability/context';
import { moduleLogger } from '../observability/logger';

import type { Principal } from '../security/principal';
import type { AuditAction } from '@sunshop/shared';

const log = moduleLogger('audit');

/**
 * Writes an entry to the immutable audit trail.
 *
 * Deliberately fire-and-forget: a failed audit write must not roll back a
 * successful refund. The failure is logged at error level and alerted on, so a
 * silently broken trail still surfaces: but the customer's money moves.
 *
 * The actor, IP and request id are pulled from ambient context so call sites
 * cannot forget them.
 */
export interface AuditInput {
  action: AuditAction;
  actor: Principal;
  target?: { type: string; id?: string | null; label?: string | null } | null;
  changes?: Record<string, unknown> | null;
  reason?: string | null;
  outcome?: 'success' | 'failure';
}

export function audit(input: AuditInput): void {
  const context = getContext();

  void AuditLog.create({
    action: input.action,
    actor: {
      id: input.actor.id,
      email: input.actor.email,
      roles: input.actor.roles,
      ip: context?.ip ?? null,
      userAgent: context?.userAgent ?? null,
    },
    target: input.target ?? null,
    changes: input.changes ?? null,
    reason: input.reason ?? null,
    requestId: context?.requestId ?? null,
    outcome: input.outcome ?? 'success',
    at: new Date(),
  }).catch((error: Error) => {
    log.error({ err: error.message, action: input.action }, 'failed to write audit entry');
  });
}

/**
 * Produces a `{ field: { from, to } }` diff of only what actually changed, so
 * an audit entry for "changed the price" is not a wall of unchanged fields.
 * Values are truncated: an audit log is not a backup.
 */
export function diff(
  before: Record<string, unknown>,
  after: Record<string, unknown>,
  fields?: readonly string[],
): Record<string, { from: unknown; to: unknown }> {
  const keys = fields ?? [...new Set([...Object.keys(before), ...Object.keys(after)])];
  const changes: Record<string, { from: unknown; to: unknown }> = {};

  for (const field of keys) {
    const from = before[field];
    const to = after[field];
    if (to === undefined) continue;
    if (JSON.stringify(from) === JSON.stringify(to)) continue;
    changes[field] = { from: truncate(from), to: truncate(to) };
  }

  return changes;
}

function truncate(value: unknown): unknown {
  if (typeof value === 'string' && value.length > 200) return `${value.slice(0, 200)}…`;
  if (Array.isArray(value) && value.length > 20)
    return [...value.slice(0, 20), `…+${value.length - 20}`];
  return value;
}
