import { Reservation } from '../../models/Reservation';
import { User } from '../../models/User';
import { config } from '../../config/env';
import { notificationService } from '../../utils/notification';

export interface CompleteDueResult {
  matched: number;
  modified: number;
  ranAt: Date;
}

/**
 * Auto-complete reservations whose time has fully passed.
 *
 * Rules:
 *  - only reservations with status 'confirmed' are affected;
 *  - their end instant (`endAt`, already computed from date + endTime in Iran
 *    time) must be at or before `now`;
 *  - 'cancelled' / 'no_show' / already 'completed' reservations are untouched.
 *
 * This is a single bulk update with a conditional filter, so it is:
 *  - efficient (one round-trip, not record-by-record);
 *  - idempotent (a second run matches nothing new);
 *  - safe across multiple server instances (the filter only ever moves
 *    due 'confirmed' rows to 'completed'; concurrent runs converge).
 *
 * `now` is injectable for testing.
 */
export async function completeDueReservations(now: Date = new Date()): Promise<CompleteDueResult> {
  // Capture the rows about to complete (so we know exactly who to notify) BEFORE
  // flipping them, then mark them all completed in one bulk update.
  const due = await Reservation.find({ status: 'confirmed', endAt: { $lte: now } })
    .select('_id customerId date startTime completionNotifiedAt')
    .lean();

  const result = await Reservation.updateMany(
    { status: 'confirmed', endAt: { $lte: now } },
    { $set: { status: 'completed', completedAt: now } },
  );

  // Send the review/tip invite ONCE per reservation (completionNotifiedAt flag).
  const toNotify = due.filter((r) => !r.completionNotifiedAt);
  if (toNotify.length > 0) {
    void (async () => {
      try {
        const customers = await User.find({ _id: { $in: toNotify.map((r) => r.customerId) } })
          .select('phone')
          .lean();
        const phoneById = new Map(customers.map((u) => [String(u._id), u.phone]));
        const link = `${config.webBaseUrl}/dashboard/customer`;
        for (const r of toNotify) {
          const phone = phoneById.get(String(r.customerId));
          if (phone) void notificationService.serviceCompleted(phone, { link });
        }
        // Mark notified so a later run never re-sends.
        await Reservation.updateMany(
          { _id: { $in: toNotify.map((r) => r._id) } },
          { $set: { completionNotifiedAt: now } },
        );
      } catch {
        /* best-effort — never throw out of the cron pass */
      }
    })();
  }

  return {
    matched: result.matchedCount ?? 0,
    modified: result.modifiedCount ?? 0,
    ranAt: now,
  };
}
