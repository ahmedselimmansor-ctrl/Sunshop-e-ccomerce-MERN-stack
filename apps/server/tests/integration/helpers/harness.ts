import { MongoMemoryReplSet } from 'mongodb-memory-server';
import mongoose from 'mongoose';
import supertest from 'supertest';

import type { Express } from 'express';
import type TestAgent from 'supertest/lib/agent';

/**
 * Integration harness: a real Express app over a real database.
 *
 * A replica set, not a standalone. Checkout, refunds and inventory all run
 * inside multi-document transactions, and MongoDB only offers those on a
 * replica set, so a standalone would pass every test that does not matter and
 * fail the moment someone actually bought something.
 *
 * Mongo is in-memory so the suite is hermetic and parallel-safe. Redis is the
 * real thing on database 15: rate limiting, idempotency and refresh-token
 * rotation are all implemented in Lua and atomic operations whose behaviour a
 * mock would only approximate, and those are exactly the paths worth testing.
 */
export interface Harness {
  app: Express;
  /**
   * A cookie-persisting agent, not a bare `supertest(app)`.
   *
   * A guest cart is identified by a cookie the API issues on first contact, so
   * without a jar an add and the update that follows it land on two different
   * carts. `reset()` replaces the agent, because a jar that outlives a test
   * leaks credentials into the next one: `/auth/refresh` prefers the cookie
   * over the body, so a stale `sunshop_rt` from an earlier login silently
   * hijacked a later test's refresh and failed it against a flushed session.
   */
  request: TestAgent;
  /** Empties every collection, leaving indexes in place. */
  reset: () => Promise<void>;
  stop: () => Promise<void>;
}

export async function startHarness(): Promise<Harness> {
  const replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });

  process.env.MONGO_URI = replSet.getUri('sunshop-test');

  // Imported after the URI is in place: config/env.ts reads it at module load.
  const { connectMongo, disconnectMongo } = await import('../../../src/db/mongoose');
  const { connectRedis, disconnectRedis, redis } = await import('../../../src/db/redis');
  const { createApp } = await import('../../../src/app');

  await connectMongo(process.env.MONGO_URI);
  await connectRedis();

  // A previous crashed run can leave keys behind, and a stale rate-limit
  // counter fails the next suite for reasons that have nothing to do with it.
  await redis.flushdb();

  const app = createApp();

  const harness: Harness = {
    app,
    request: supertest.agent(app),
    reset: async () => {
      const { collections } = mongoose.connection;
      await Promise.all(Object.values(collections).map((c) => c.deleteMany({})));
      await redis.flushdb();
      harness.request = supertest.agent(app);
    },
    stop: async () => {
      await disconnectRedis();
      await disconnectMongo();
      await replSet.stop();
    },
  };

  return harness;
}
