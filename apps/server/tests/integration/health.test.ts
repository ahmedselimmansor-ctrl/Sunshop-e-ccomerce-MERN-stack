import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { startHarness, type Harness } from './helpers/harness';

/**
 * Boots the real app against a real database and checks the probes Kubernetes
 * relies on. If this file fails, nothing else in the integration suite means
 * anything.
 */
describe('health probes', () => {
  let h: Harness;

  beforeAll(async () => {
    h = await startHarness();
  }, 120_000);

  afterAll(async () => {
    await h?.stop();
  });

  it('reports liveness without touching a dependency', async () => {
    const response = await h.request.get('/healthz');

    expect(response.status).toBe(200);
    expect(response.body.status).toBe('ok');
  });

  it('reports readiness only once mongo and redis answer', async () => {
    const response = await h.request.get('/readyz');

    expect(response.status).toBe(200);
    expect(response.body.checks).toMatchObject({ mongodb: 'up', redis: 'up' });
  });

  it('exposes prometheus metrics', async () => {
    const response = await h.request.get('/metrics');

    expect(response.status).toBe(200);
    expect(response.text).toContain('# HELP');
  });

  it('answers an unknown route with the standard error envelope', async () => {
    const response = await h.request.get('/api/v1/nope');

    expect(response.status).toBe(404);
    expect(response.body.ok).toBe(false);
    expect(response.body.error).toMatchObject({ code: 'NOT_FOUND' });
    expect(response.body.error.requestId).toEqual(expect.any(String));
  });
});
