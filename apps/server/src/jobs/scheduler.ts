import cron, { type ScheduledTask } from 'node-cron';

import { redis } from '../db/redis';
import { refreshProductCounts } from '../modules/categories/category.service';
import { releaseExpiredReservations } from '../modules/orders/order.service';
import { moduleLogger } from '../observability/logger';
import { jobDuration, jobRuns } from '../observability/metrics';

import { drainOutbox, reportOutboxBacklog } from './outboxWorker';

const log = moduleLogger('scheduler');

const tasks: ScheduledTask[] = [];

/**
 * Scheduled work.
 *
 * Every pod runs the scheduler, so each job takes a short Redis lock before
 * doing anything: with three replicas, an unguarded cron would release the same
 * expired reservations three times and triple-count the restock.
 *
 * The lock TTL is set slightly above each job's expected runtime: long enough
 * that a slow run is not preempted, short enough that a pod dying mid-job does
 * not block the next tick for long.
 */
async function withLock(name: string, ttlSeconds: number, fn: () => Promise<void>): Promise<void> {
  const lockKey = `job:lock:${name}`;
  const acquired = await redis
    .set(lockKey, process.env.HOSTNAME ?? 'local', 'EX', ttlSeconds, 'NX')
    .catch(() => null);

  if (acquired !== 'OK') return;

  const stopTimer = jobDuration.startTimer({ job: name });

  try {
    await fn();
    jobRuns.inc({ job: name, outcome: 'success' });
  } catch (error) {
    jobRuns.inc({ job: name, outcome: 'failure' });
    log.error({ err: (error as Error).message, job: name }, 'scheduled job failed');
  } finally {
    stopTimer();
    // Release early so the next tick is not blocked by a job that finished fast.
    await redis.del(lockKey).catch(() => undefined);
  }
}

export function startScheduler(): void {
  // ── Outbox: the closest thing to a real-time worker ──────────────────────
  // Every 5 seconds. Not locked: the claim query is already atomic, and
  // several drainers in parallel is a feature, not a race.
  tasks.push(
    cron.schedule('*/5 * * * * *', () => {
      void drainOutbox().catch((error: Error) =>
        log.error({ err: error.message }, 'outbox drain failed'),
      );
    }),
  );

  // ── Inventory: release holds from abandoned checkouts, every minute ──────
  tasks.push(
    cron.schedule('* * * * *', () => {
      void withLock('release-reservations', 55, async () => {
        const released = await releaseExpiredReservations();
        if (released > 0) log.info({ released }, 'expired reservations released');
      });
    }),
  );

  // ── Metrics: backlog gauge, every 30 seconds ────────────────────────────
  tasks.push(
    cron.schedule('*/30 * * * * *', () => {
      void reportOutboxBacklog().catch(() => undefined);
    }),
  );

  // ── Catalogue: recompute category product counts nightly at 02:15 UTC ────
  tasks.push(
    cron.schedule('15 2 * * *', () => {
      void withLock('refresh-product-counts', 600, async () => {
        await refreshProductCounts();
        log.info('category product counts refreshed');
      });
    }),
  );

  // ── Search: nightly consistency pass at 03:30 UTC ────────────────────────
  // The outbox keeps the index current; this catches anything a dead-lettered
  // event dropped, so the index cannot silently drift for weeks.
  tasks.push(
    cron.schedule('30 3 * * *', () => {
      void withLock('reindex', 3600, async () => {
        const { reindexAll } = await import('../search/reindex');
        const result = await reindexAll();
        log.info(result, 'nightly reindex complete');
      });
    }),
  );

  log.info({ jobs: tasks.length }, 'scheduler started');
}

export function stopScheduler(): void {
  for (const task of tasks) task.stop();
  tasks.length = 0;
  log.info('scheduler stopped');
}
