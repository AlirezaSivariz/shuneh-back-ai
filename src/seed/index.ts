import { connectDb, disconnectDb } from '../config/db';
import { seedServiceCatalogue } from './seed';
import { seedCommunity } from './community.seed';

/**
 * Manual seed entrypoint (`npm run seed`). Idempotent: re-running it does not
 * create duplicate categories, services, or community demo content.
 */
async function run() {
  await connectDb();
  const result = await seedServiceCatalogue();
  // eslint-disable-next-line no-console
  console.log(`[seed] done: ${result.categories} categories, ${result.services} services`);
  const community = await seedCommunity();
  // eslint-disable-next-line no-console
  console.log(
    `[seed] community: ${community.users} users, ${community.questions} questions, ${community.answers} answers, ${community.likes} likes`,
  );
  await disconnectDb();
}

run().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[seed] failed:', err);
  process.exit(1);
});
