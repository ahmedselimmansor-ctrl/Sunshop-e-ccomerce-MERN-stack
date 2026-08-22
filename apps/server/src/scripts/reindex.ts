/* eslint-disable no-console */
import { connectMongo, disconnectMongo } from '../db/mongoose';
import { connectRedis, disconnectRedis } from '../db/redis';
import { closeSearch, pingSearch } from '../search/client';
import { reindexAll } from '../search/reindex';

/**
 * Full search reindex, run as a Kubernetes Job after a mapping change or as a
 * manual repair. Safe to run against production: it builds a new index and only
 * swaps the alias once the build succeeds.
 */
async function main(): Promise<void> {
  await connectMongo();
  await connectRedis();

  const reachable = await pingSearch();
  if (!reachable) {
    console.error('✖ Elasticsearch is not reachable: aborting.');
    process.exitCode = 1;
    return;
  }

  const startedAt = Date.now();
  const result = await reindexAll();
  const seconds = ((Date.now() - startedAt) / 1000).toFixed(1);

  console.log(`✓ Reindexed ${result.indexed} products in ${seconds}s (${result.errors} errors)`);
  console.log(`  index: ${result.index}`);

  if (result.errors > 0) process.exitCode = 1;
}

main()
  .catch((error: Error) => {
    console.error('✖ Reindex failed:', error);
    process.exitCode = 1;
  })
  .finally(async () => {
    await Promise.allSettled([disconnectMongo(), disconnectRedis(), closeSearch()]);
    process.exit(process.exitCode ?? 0);
  });
