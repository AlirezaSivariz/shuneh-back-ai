import { Reservation } from '../../models/Reservation';

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
  const result = await Reservation.updateMany(
    { status: 'confirmed', endAt: { $lte: now } },
    { $set: { status: 'completed', completedAt: now } },
  );

  return {
    matched: result.matchedCount ?? 0,
    modified: result.modifiedCount ?? 0,
    ranAt: now,
  };
}
