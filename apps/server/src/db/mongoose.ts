import mongoose from 'mongoose';

import { env, isProduction, isTest } from '../config/env';
import { moduleLogger } from '../observability/logger';
import { dbQueryDuration, dependencyUp } from '../observability/metrics';

const log = moduleLogger('mongo');

/**
 * MongoDB / Amazon DocumentDB connection.
 *
 * Notes that matter in production:
 *  • `strictQuery` on: an unknown field in a filter throws instead of silently
 *    matching every document, which is how "delete one" becomes "delete all".
 *  • Pool size is bounded per pod; DocumentDB connection limits are per-cluster,
 *    so `maxPoolSize × replicas` must stay under the instance-class limit.
 *  • `retryWrites` is unsupported by DocumentDB and must be off there; the
 *    connection string carries it, so it is not hardcoded here.
 */
mongoose.set('strictQuery', true);
mongoose.set('autoIndex', !isProduction); // indexes are created by a migration job in prod

/**
 * `sanitizeFilter` is deliberately **off**.
 *
 * It rewrites *every* object-valued filter containing a `$` key into `$eq`,
 * which breaks legitimate `$in`/`$gte`/`$regex` usage across the whole codebase
 * unless each one is wrapped in `mongoose.trusted()`: an opt-out that is easy
 * to forget and therefore a worse defence than it looks.
 *
 * Operator injection is instead blocked one layer earlier, where the untrusted
 * data actually enters: `middleware/security.ts#sanitizeInput` strips
 * `$`-prefixed and dotted keys from every body, query and param, and zod
 * validation then admits only known fields of known types. Filters built inside
 * services are constructed from validated primitives, never spread from a
 * request body.
 */

if (env.LOG_LEVEL === 'trace') {
  mongoose.set('debug', (collection: string, method: string, query: unknown) => {
    log.trace({ collection, method, query }, 'mongo command');
  });
}

let connected = false;

export async function connectMongo(uri: string = env.MONGO_URI): Promise<typeof mongoose> {
  if (connected) return mongoose;

  const connection = await mongoose.connect(uri, {
    maxPoolSize: env.MONGO_MAX_POOL_SIZE,
    minPoolSize: env.MONGO_MIN_POOL_SIZE,
    serverSelectionTimeoutMS: 8000,
    socketTimeoutMS: 45_000,
    heartbeatFrequencyMS: 10_000,
    /**
     * `primary`, not `primaryPreferred`.
     *
     * Two reasons. MongoDB rejects any read inside a multi-document transaction
     * that is not `primary`, so a connection-wide `primaryPreferred` makes every
     * transactional path (checkout, refunds, inventory) fail at runtime. And
     * commerce reads are overwhelmingly read-your-own-write: a cart that shows
     * stale contents right after an add is a bug report, not a saving.
     *
     * Read scaling comes from the Redis cache layer instead; the few genuinely
     * stale-tolerant queries (analytics aggregates) opt in per query with
     * `.read('secondaryPreferred')`.
     */
    readPreference: 'primary',
    ...(env.MONGO_TLS_CA_FILE ? { tls: true, tlsCAFile: env.MONGO_TLS_CA_FILE } : {}),
    ...(isTest ? { serverSelectionTimeoutMS: 3000 } : {}),
  });

  connected = true;
  dependencyUp.set({ dependency: 'mongodb' }, 1);
  log.info({ host: connection.connection.host, db: connection.connection.name }, 'mongo connected');

  return connection;
}

mongoose.connection.on('disconnected', () => {
  connected = false;
  dependencyUp.set({ dependency: 'mongodb' }, 0);
  log.warn('mongo disconnected');
});

mongoose.connection.on('reconnected', () => {
  connected = true;
  dependencyUp.set({ dependency: 'mongodb' }, 1);
  log.info('mongo reconnected');
});

mongoose.connection.on('error', (error: Error) => {
  dependencyUp.set({ dependency: 'mongodb' }, 0);
  log.error({ err: error.message }, 'mongo error');
});

/** Times every command into the Prometheus histogram. */
mongoose.plugin((schema) => {
  const timed = [
    'find',
    'findOne',
    'findOneAndUpdate',
    'updateOne',
    'updateMany',
    'deleteOne',
    'countDocuments',
    'aggregate',
  ] as const;
  for (const hook of timed) {
    schema.pre(hook as never, function preHook(this: { _startedAt?: number }) {
      this._startedAt = performance.now();
    });
    schema.post(
      hook as never,
      function postHook(this: { _startedAt?: number; model?: { collection?: { name?: string } } }) {
        if (!this._startedAt) return;
        const seconds = (performance.now() - this._startedAt) / 1000;
        dbQueryDuration.observe(
          { collection: this.model?.collection?.name ?? 'unknown', operation: hook },
          seconds,
        );
      },
    );
  }
});

export async function disconnectMongo(): Promise<void> {
  if (!connected && mongoose.connection.readyState === 0) return;
  await mongoose.disconnect();
  connected = false;
}

export function isMongoHealthy(): boolean {
  return mongoose.connection.readyState === 1;
}

export async function pingMongo(): Promise<boolean> {
  try {
    const admin = mongoose.connection.db?.admin();
    if (!admin) return false;
    const result = await admin.ping();
    return result?.ok === 1;
  } catch {
    return false;
  }
}

/**
 * Runs `fn` inside a transaction when the deployment supports them (a replica
 * set or DocumentDB 4.0+), and inline otherwise. Local single-node Mongo has no
 * transactions, so tests and laptops still work without branching call sites.
 */
export async function withTransaction<T>(
  fn: (session: mongoose.ClientSession | undefined) => Promise<T>,
): Promise<T> {
  const supportsTransactions = Boolean(mongoose.connection.db) && !isTest;

  if (!supportsTransactions) return fn(undefined);

  const session = await mongoose.startSession();
  try {
    let result!: T;
    await session.withTransaction(
      async () => {
        result = await fn(session);
      },
      {
        // `majority` on both sides: a checkout that is acknowledged must not be
        // rolled back by a failover, and reads inside it must see the writes
        // this transaction has already made.
        readConcern: { level: 'majority' },
        writeConcern: { w: 'majority' },
        readPreference: 'primary',
      },
    );
    return result;
  } catch (error) {
    // A single-node deployment reports this; fall back rather than 500.
    const message = error instanceof Error ? error.message : '';
    if (message.includes('Transaction numbers') || message.includes('replica set')) {
      log.warn('transactions unsupported on this deployment; running without one');
      return fn(undefined);
    }
    throw error;
  } finally {
    await session.endSession();
  }
}

export { mongoose };
