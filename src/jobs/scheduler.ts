import { config } from '../config/env';
import { completeDueReservations } from '../modules/reservation/reservation.service';
import { releaseExpiredHolds } from '../modules/reservation/reservation.customer.service';
import { purgeExpiredStories } from '../modules/social/story.service';
import { downgradeExpiredPlans, sendPlanExpiryReminders } from '../modules/plan/plan.expiry';
import { childLogger } from '../utils/logger';

const log = childLogger({ module: 'cron' });

/** How often expired 24h stories are purged (record + image). Read-time filtering
 * already hides them; this only reclaims storage. */
const STORY_PURGE_INTERVAL_MIN = 60;

/**
 * Lightweight job scheduler.
 *
 * The scheduler is a thin wrapper: it owns timing only, while all business
 * logic lives in the services it calls. Swapping setInterval for node-cron
 * later would not touch any service code.
 *
 * Disable entirely with DISABLE_CRON=true (tests, one-off scripts, or when a
 * separate worker process owns the jobs).
 */
const timers: NodeJS.Timeout[] = [];

async function runReservationAutoComplete(): Promise<void> {
  try {
    const result = await completeDueReservations();
    if (result.modified > 0) {
      log.info({ modified: result.modified }, 'Auto-completed reservations');
    }
  } catch (err) {
    // Never let a job error crash the process; log and wait for the next tick.
    log.error({ err }, 'Reservation auto-complete failed');
  }
}

async function runHoldCleanup(): Promise<void> {
  try {
    const { removed } = await releaseExpiredHolds();
    if (removed > 0) {
      log.info({ removed }, 'Released abandoned payment holds');
    }
  } catch (err) {
    log.error({ err }, 'Reservation hold cleanup failed');
  }
}

async function runStoryPurge(): Promise<void> {
  try {
    const { removed } = await purgeExpiredStories();
    if (removed > 0) {
      log.info({ removed }, 'Purged expired stories');
    }
  } catch (err) {
    log.error({ err }, 'Story purge failed');
  }
}

async function runPlanExpiry(): Promise<void> {
  try {
    const downgraded = await downgradeExpiredPlans();
    if (downgraded > 0) {
      log.info({ downgraded }, 'Downgraded expired plans to free');
    }
    const reminded = await sendPlanExpiryReminders();
    if (reminded > 0) {
      log.info({ reminded }, 'Sent plan expiry reminders');
    }
  } catch (err) {
    log.error({ err }, 'Plan expiry job failed');
  }
}

export function startScheduledJobs(): void {
  if (config.disableCron) {
    log.info('Cron disabled (DISABLE_CRON) — no jobs registered');
    return;
  }

  const intervalMs = Math.max(1, config.autoCompleteIntervalMinutes) * 60 * 1000;

  // Clear any backlog right away, then on the configured interval.
  void runReservationAutoComplete();

  const timer = setInterval(runReservationAutoComplete, intervalMs);
  // Don't keep the event loop alive solely for this timer.
  timer.unref?.();
  timers.push(timer);

  // Release abandoned payment holds on the same cadence as auto-complete.
  void runHoldCleanup();
  const holdTimer = setInterval(runHoldCleanup, intervalMs);
  holdTimer.unref?.();
  timers.push(holdTimer);

  // Expired-story cleanup (storage reclaim; read-time filter handles visibility).
  void runStoryPurge();
  const storyTimer = setInterval(runStoryPurge, STORY_PURGE_INTERVAL_MIN * 60 * 1000);
  storyTimer.unref?.();
  timers.push(storyTimer);

  // Plan expiry: downgrade expired + send 5/3/1-day reminders (each milestone
  // is sent once per plan period; hourly cadence just picks up new periods).
  // Reminders are quiet outside 08:00–20:00 Asia/Tehran (see plan.expiry.ts).
  const PLAN_EXPIRY_INTERVAL_MS = 60 * 60 * 1000;
  void runPlanExpiry();
  const planTimer = setInterval(runPlanExpiry, PLAN_EXPIRY_INTERVAL_MS);
  planTimer.unref?.();
  timers.push(planTimer);

  log.info(
    { autoCompleteMinutes: config.autoCompleteIntervalMinutes, storyPurgeMinutes: STORY_PURGE_INTERVAL_MIN, planExpiryMinutes: 60 },
    'Cron jobs registered',
  );
}

/** Stop all scheduled jobs (graceful shutdown / tests). */
export function stopScheduledJobs(): void {
  while (timers.length) {
    const timer = timers.pop();
    if (timer) clearInterval(timer);
  }
}
