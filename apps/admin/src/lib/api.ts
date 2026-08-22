import {
  CORRELATION_ID_HEADER,
  GUEST_CART_HEADER,
  IDEMPOTENCY_KEY_HEADER,
  LOCALE_HEADER,
  type ApiError,
  type ErrorCode,
  type PaginationMeta,
} from '@sunshop/shared';

const BASE_URL: string = import.meta.env.VITE_API_URL ?? '/api/v1';

/**
 * HTTP client.
 *
 * Deliberately built on `fetch` rather than a client library: the whole
 * surface is one envelope shape, and the only non-trivial behaviour is the
 * refresh flow below, which no library would handle the way this API needs.
 *
 * **Token handling.** The access token lives in memory only. Putting it in
 * `localStorage` would make it readable by any injected script; keeping it in a
 * module variable means an XSS payload has to be running *at that moment* to
 * steal it, and it dies with the tab. Durability comes from the refresh token,
 * which is an httpOnly cookie the JavaScript context cannot read at all.
 *
 * **Refresh.** A 401 triggers exactly one refresh attempt, and concurrent 401s
 * share that single in-flight promise: otherwise a page that fires six
 * requests on mount would fire six refreshes, and refresh-token rotation would
 * see five of them as replays and revoke the whole session.
 */

let accessToken: string | null = null;
let refreshPromise: Promise<boolean> | null = null;
let onUnauthenticated: (() => void) | null = null;

export function setAccessToken(token: string | null): void {
  accessToken = token;
}

export function getAccessToken(): string | null {
  return accessToken;
}

/** Registered by the auth store so a hard 401 can clear client state. */
export function setUnauthenticatedHandler(handler: () => void): void {
  onUnauthenticated = handler;
}

export class ApiClientError extends Error {
  readonly status: number;
  readonly code: ErrorCode | string;
  readonly details?: { path: string; message: string }[];
  readonly requestId?: string;
  readonly retryAfter?: number;

  constructor(status: number, payload: ApiError['error'] | null, fallback: string) {
    super(payload?.message ?? fallback);
    this.name = 'ApiClientError';
    this.status = status;
    this.code = payload?.code ?? 'INTERNAL_ERROR';
    this.details = payload?.details;
    this.requestId = payload?.requestId;
    this.retryAfter = payload?.retryAfter;
  }

  /** Maps server field errors onto react-hook-form paths. */
  get fieldErrors(): Record<string, string> {
    const entries = (this.details ?? []).map((issue) => [
      issue.path.replace(/^body\./, ''),
      issue.message,
    ]);
    return Object.fromEntries(entries);
  }
}

export interface RequestOptions extends Omit<RequestInit, 'body'> {
  body?: unknown;
  /** Skip the automatic refresh-and-retry (used by the refresh call itself). */
  skipAuthRetry?: boolean;
  idempotencyKey?: string;
  locale?: string;
  signal?: AbortSignal;
}

function guestCartToken(): string | null {
  try {
    return localStorage.getItem('sunshop-cart-token');
  } catch {
    return null;
  }
}

export function setGuestCartToken(token: string): void {
  try {
    localStorage.setItem('sunshop-cart-token', token);
  } catch {
    /* private browsing: the cookie still carries it */
  }
}

function currentLocale(): string {
  return document.documentElement.lang || 'en';
}

async function performRequest(path: string, options: RequestOptions): Promise<Response> {
  const headers = new Headers(options.headers);

  headers.set('Accept', 'application/json');
  headers.set(LOCALE_HEADER, options.locale ?? currentLocale());

  if (options.body !== undefined) headers.set('Content-Type', 'application/json');
  if (accessToken) headers.set('Authorization', `Bearer ${accessToken}`);
  if (options.idempotencyKey) headers.set(IDEMPOTENCY_KEY_HEADER, options.idempotencyKey);

  const cartToken = guestCartToken();
  if (cartToken) headers.set(GUEST_CART_HEADER, cartToken);

  return fetch(`${BASE_URL}${path}`, {
    ...options,
    headers,
    // Required for the refresh cookie to travel cross-origin.
    credentials: 'include',
    body: options.body !== undefined ? JSON.stringify(options.body) : undefined,
  });
}

async function refreshSession(): Promise<boolean> {
  refreshPromise ??= (async () => {
    try {
      const response = await fetch(`${BASE_URL}/auth/refresh`, {
        method: 'POST',
        credentials: 'include',
        headers: { 'Content-Type': 'application/json' },
        body: '{}',
      });

      if (!response.ok) return false;

      const payload = (await response.json()) as {
        data?: { tokens?: { accessToken?: string } };
      };
      const token = payload.data?.tokens?.accessToken;
      if (!token) return false;

      accessToken = token;
      return true;
    } catch {
      return false;
    } finally {
      // Cleared on the next tick so simultaneous callers all observe the same
      // resolution before a new attempt can begin.
      setTimeout(() => {
        refreshPromise = null;
      }, 0);
    }
  })();

  return refreshPromise;
}

async function parseError(response: Response): Promise<ApiClientError> {
  let payload: ApiError | null = null;
  try {
    payload = (await response.json()) as ApiError;
  } catch {
    /* non-JSON error body (gateway timeout, HTML error page) */
  }
  return new ApiClientError(response.status, payload?.error ?? null, response.statusText);
}

export async function request<T>(path: string, options: RequestOptions = {}): Promise<T> {
  let response = await performRequest(path, options);

  if (response.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshSession();
    if (refreshed) {
      response = await performRequest(path, { ...options, skipAuthRetry: true });
    } else {
      accessToken = null;
      onUnauthenticated?.();
    }
  }

  // The server hands guests a cart token on first contact; persist it so a
  // returning guest keeps their basket even without cookies.
  const issuedCartToken = response.headers.get(GUEST_CART_HEADER);
  if (issuedCartToken) setGuestCartToken(issuedCartToken);

  if (!response.ok) throw await parseError(response);
  if (response.status === 204) return undefined as T;

  const payload = (await response.json()) as { ok: boolean; data: T };
  return payload.data;
}

/** For endpoints that return `{ data, meta }`: list responses. */
export async function requestPaginated<T>(
  path: string,
  options: RequestOptions = {},
): Promise<{ data: T[]; meta: PaginationMeta; facets?: unknown }> {
  const response = await performRequest(path, options);

  if (response.status === 401 && !options.skipAuthRetry) {
    const refreshed = await refreshSession();
    if (refreshed) return requestPaginated<T>(path, { ...options, skipAuthRetry: true });
    accessToken = null;
    onUnauthenticated?.();
  }

  if (!response.ok) throw await parseError(response);

  return (await response.json()) as { data: T[]; meta: PaginationMeta; facets?: unknown };
}

export const api = {
  get: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'GET' }),
  post: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'POST', body }),
  patch: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PATCH', body }),
  put: <T>(path: string, body?: unknown, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'PUT', body }),
  delete: <T>(path: string, options?: RequestOptions) =>
    request<T>(path, { ...options, method: 'DELETE' }),
  list: requestPaginated,
};

/** Serializes a filter object into a query string, dropping empty values. */
export function toQuery(params: Record<string, unknown>): string {
  const search = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '') continue;
    if (Array.isArray(value)) {
      if (value.length > 0) search.set(key, value.join(','));
    } else if (typeof value === 'object') {
      // Nested option filters: `options[color]=black`.
      for (const [nestedKey, nestedValue] of Object.entries(value as Record<string, unknown>)) {
        if (nestedValue) search.set(`${key}[${nestedKey}]`, String(nestedValue));
      }
    } else {
      search.set(key, String(value));
    }
  }

  const query = search.toString();
  return query ? `?${query}` : '';
}

export { CORRELATION_ID_HEADER };
