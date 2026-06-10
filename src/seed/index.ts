import { connectDb, disconnectDb } from '../config/db';
import { seedServiceCatalogue } from './seed';

/**
 * Manual seed entrypoint (`npm run seed`). Idempotent: re-running it does not
 * create duplicate categories or services.
 */
async function run() {
  await connectDb();
  const result = await seedServiceCatalogue();
  // eslint-disable-next-line no-console
  console.log(`[seed] done: ${result.categories} categories, ${result.services} services`);
  await disconnectDb();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed:', err);
  process.exit(1);
});
