import { createApp } from './app';
import { connectDb } from './config/db';
import { config } from './config/env';
import {
  autoSeedIfEmpty,
  migrateLegacySalonServiceGender,
  migrateStylistPlanTier,
  migrateBlogCoverKeys,
  migratePromotions,
  migrateSocialPostType,
} from './seed/seed';
import { startScheduledJobs, stopScheduledJobs } from './jobs/scheduler';
import { ensureStorageReady } from './utils/storage';

async function bootstrap() {
  await connectDb();

  // Ensure the default service catalogue exists on a fresh database.
  await autoSeedIfEmpty();
  // Drop the removed 'unisex' service gender from any legacy salons.
  await migrateLegacySalonServiceGender();
  // Backfill planTier from the legacy smsCampaignEnabled flag.
  await migrateStylistPlanTier();
  // Repair blog cover images stored as a (re-prefixed) URL → bare key.
  await migrateBlogCoverKeys();
  // Backfill the Promotion collection from legacy profile promotion flags.
  await migratePromotions();
  // Social post type photo→normal (phase-2 rename).
  await migrateSocialPostType();

  // Pre-create object-storage buckets (S3/MinIO) so uploads don't 500 on a
  // fresh endpoint. Best-effort: the provider also self-heals lazily per upload.
  try {
    await ensureStorageReady();
  } catch (err) {
    // eslint-disable-next-line no-console
    console.error('[storage] bucket warm-up failed (will retry on first upload):', err);
  }

  const app = createApp();

  // Register background jobs (reservation auto-complete, ...). Honors DISABLE_CRON.
  startScheduledJobs();

  const server = app.listen(config.port, () => {
    // eslint-disable-next-line no-console
    console.log(`[server] listening on ${config.baseUrl} (port ${config.port})`);
  });

  // Graceful shutdown: stop timers and the HTTP server.
  const shutdown = (signal: string) => {
    // eslint-disable-next-line no-console
    console.log(`[server] ${signal} received, shutting down`);
    stopScheduledJobs();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  // eslint-disable-next-line no-console
  console.error('[server] failed to start:', err);
  process.exit(1);
});
