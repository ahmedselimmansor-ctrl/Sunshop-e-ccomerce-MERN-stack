import { AsyncLocalStorage } from 'node:async_hooks';

import type { Role } from '@sunshop/shared';

/**
 * Per-request ambient context.
 *
 * Threading a request id through every function signature is noise; an
 * AsyncLocalStorage keeps it available to the logger, the audit writer and the
 * cache layer without polluting service APIs. It is read-only by convention:
 * only the request-context middleware writes it.
 */
export interface RequestContext {
  requestId: string;
  /** Populated after authentication; absent for anonymous traffic. */
  userId?: string;
  sessionId?: string;
  roles?: Role[];
  ip?: string;
  userAgent?: string;
  locale?: string;
  method?: string;
  route?: string;
  startedAt: number;
}

const storage = new AsyncLocalStorage<RequestContext>();

export function runWithContext<T>(context: RequestContext, fn: () => T): T {
  return storage.run(context, fn);
}

export function getContext(): RequestContext | undefined {
  return storage.getStore();
}

export function getRequestId(): string | undefined {
  return storage.getStore()?.requestId;
}

/** Mutates the active context: used once auth resolves the principal. */
export function setContextValues(values: Partial<RequestContext>): void {
  const store = storage.getStore();
  if (!store) return;
  Object.assign(store, values);
}
