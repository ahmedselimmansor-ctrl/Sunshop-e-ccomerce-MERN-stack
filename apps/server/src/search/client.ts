import { Client } from '@elastic/elasticsearch';

import { env } from '../config/env';
import { moduleLogger } from '../observability/logger';
import { dependencyUp } from '../observability/metrics';

const log = moduleLogger('search');

/**
 * Elasticsearch / Amazon OpenSearch client.
 *
 * Search is a *degradable* dependency: if the cluster is unavailable the API
 * falls back to a MongoDB text query rather than failing the request. A
 * storefront with slightly worse relevance still sells; a storefront that 503s
 * on every search does not. `isSearchAvailable()` is the switch that decides.
 */
export const elastic = new Client({
  node: env.ELASTICSEARCH_NODE,
  ...(env.ELASTICSEARCH_USERNAME && env.ELASTICSEARCH_PASSWORD
    ? { auth: { username: env.ELASTICSEARCH_USERNAME, password: env.ELASTICSEARCH_PASSWORD } }
    : {}),
  maxRetries: 2,
  requestTimeout: 5000,
  // A slow search must not hold a pod's socket open behind an ALB timeout.
  pingTimeout: 2000,
  compression: true,
});

export const INDEX = {
  products: `${env.ELASTICSEARCH_INDEX_PREFIX}-products`,
  suggestions: `${env.ELASTICSEARCH_INDEX_PREFIX}-suggestions`,
} as const;

let available = false;
let lastCheck = 0;
const CHECK_INTERVAL_MS = 15_000;

export async function pingSearch(): Promise<boolean> {
  if (!env.ELASTICSEARCH_ENABLED) return false;
  try {
    const response = await elastic.ping();
    available = Boolean(response);
    dependencyUp.set({ dependency: 'elasticsearch' }, available ? 1 : 0);
  } catch (error) {
    available = false;
    dependencyUp.set({ dependency: 'elasticsearch' }, 0);
    log.warn({ err: (error as Error).message }, 'elasticsearch ping failed');
  }
  lastCheck = Date.now();
  return available;
}

/**
 * Cheap, cached availability check for the request path: never let a search
 * request pay for a health probe.
 */
export function isSearchAvailable(): boolean {
  if (!env.ELASTICSEARCH_ENABLED) return false;
  if (Date.now() - lastCheck > CHECK_INTERVAL_MS) {
    // Refresh in the background; answer with the last known state now.
    void pingSearch();
  }
  return available;
}

export async function closeSearch(): Promise<void> {
  await elastic.close().catch(() => undefined);
}
