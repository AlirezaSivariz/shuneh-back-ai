import { createApp } from './app';
import { connectDb } from './config/db';
import { config } from './config/env';
import logger from './utils/logger';
import {
  autoSeedIfEmpty,
  migrateLegacySalonServiceGender,
  migrateStylistPlanTier,
  migrateBlogCoverKeys,
  migratePromotions,
  migrateSocialPostType,
  autoMigrateUsernames,
} from './seed/seed';
import { seedCommunity } from './seed/community.seed';
import { startScheduledJobs, stopScheduledJobs } from './jobs/scheduler';
import { ensureStorageReady } from './utils/storage';

const log = logger.child({ module: 'server' });

// ── Process-level crash guards ──
// Unhandled rejections and uncaught exceptions are logged with full context
// before the process exits. In production, a process manager (PM2, Docker)
// will restart the container.
process.on('unhandledRejection', (reason) => {
  log.fatal({ err: reason instanceof Error ? reason : new Error(String(reason)) }, 'Unhandled rejection');
  process.exit(1);
});
process.on('uncaughtException', (err) => {
  log.fatal({ err }, 'Uncaught exception');
  process.exit(1);
});

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
  // Backfill stylist usernames for human-readable profile URLs.
  await autoMigrateUsernames();
  // Seed the community Q&A forum demo content (idempotent — never duplicates).
  if (config.seedCommunity) {
    const seeded = await seedCommunity();
    log.info(
      { users: seeded.users, questions: seeded.questions, answers: seeded.answers, likes: seeded.likes },
      'Community seed ensured',
    );
  }

  // Pre-create object-storage buckets (S3/MinIO) so uploads don't 500 on a
  // fresh endpoint. Best-effort: the provider also self-heals lazily per upload.
  try {
    await ensureStorageReady();
  } catch (err) {
    log.warn({ err }, 'Storage bucket warm-up failed (will retry on first upload)');
  }

  const app = createApp();

  // Register background jobs (reservation auto-complete, ...). Honors DISABLE_CRON.
  startScheduledJobs();

  const server = app.listen(config.port, () => {
    log.info({ port: config.port, baseUrl: config.baseUrl }, 'Server listening');
  });

  // Graceful shutdown: stop timers and the HTTP server.
  const shutdown = (signal: string) => {
    log.info({ signal }, 'Shutdown signal received, closing gracefully');
    stopScheduledJobs();
    server.close(() => process.exit(0));
  };
  process.on('SIGINT', () => shutdown('SIGINT'));
  process.on('SIGTERM', () => shutdown('SIGTERM'));
}

bootstrap().catch((err) => {
  log.fatal({ err }, 'Server failed to start');
  process.exit(1);
});
