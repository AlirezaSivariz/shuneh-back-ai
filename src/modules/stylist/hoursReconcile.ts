/**
 * Reconciling FUTURE reservations after a working-hours / opening-hours change.
 *
 * Both a stylist (editing their own working hours) and a salon owner (editing
 * the salon's opening hours) can shift the hours under reservations that were
 * already booked. Policy: existing reservations are NEVER auto-cancelled — the
 * commitment to the customer stands. Instead we
 *   1) compute each stylist's EFFECTIVE hours (their working intervals clipped
 *      to the salon's CURRENT opening hours — the same source of truth the
 *      availability/slot code uses, so there is no parallel notion of "valid"),
 *   2) find future reservations that no longer fall inside those effective
 *      hours, and
 *   3) raise `StylistProfile.needsHoursUpdate` + notify the stylist so they can
 *      reconcile (reschedule / re-open hours). Availability re-validation (in
 *      public.service) uses the very same clipping, so out-of-hours slots can
 *      neither appear nor be freshly booked.
 *
 * This mirrors the existing "orphan" cleanup in `leaveSalon` (future
 * reservations identified, owner/stylist warned) rather than introducing a
 * separate mechanism.
 */
import { Types } from 'mongoose';
import { WorkingHour } from '../../models/WorkingHour';
import { Reservation, IReservation } from '../../models/Reservation';
import { Salon, IOpeningHours } from '../../models/Salon';
import { StylistSalon } from '../../models/StylistSalon';
import { StylistProfile } from '../../models/StylistProfile';
import { User } from '../../models/User';
import { Interval, contains, intersect } from '../../utils/time';
import { notificationService } from '../../utils/notification';

/**
 * Clip a working interval to a salon's opening intervals for a weekday,
 * returning the in-hours portions. A salon that narrowed/cleared its hours
 * yields fewer (or no) sub-intervals, so stale stylist hours never reach beyond
 * the salon's real opening hours. Freelance intervals (no salon) are handled by
 * the caller and pass through unchanged.
 */
export function clipToOpeningHours(
  interval: Interval,
  dayOfWeek: number,
  openingHours: IOpeningHours[] | undefined,
): Interval[] {
  const day = openingHours?.find((h) => h.dayOfWeek === dayOfWeek);
  if (!day || day.intervals.length === 0) return [];
  const out: Interval[] = [];
  for (const iv of day.intervals) {
    const part = intersect(interval, { start: iv.start, end: iv.end });
    if (part) out.push(part);
  }
  return out;
}

/** Map key for "this weekday at this workplace" (freelance = no salon). */
function keyOf(dayOfWeek: number, salonId: string | null): string {
  return `${dayOfWeek}|${salonId ?? 'free'}`;
}

/**
 * The stylist's effective bookable intervals, keyed by weekday+workplace. Salon
 * intervals are clipped to the salon's current opening hours; freelance ones
 * pass through. One bulk read of working hours + one of the referenced salons.
 */
async function buildEffectiveHours(stylistId: string): Promise<Map<string, Interval[]>> {
  const hours = await WorkingHour.find({ stylistId }).lean();

  const salonIds = [
    ...new Set(hours.map((h) => (h.salonId ? String(h.salonId) : null)).filter(Boolean)),
  ] as string[];
  const salons = salonIds.length
    ? await Salon.find({ _id: { $in: salonIds } }).select('openingHours').lean()
    : [];
  const openingBySalon = new Map(salons.map((s) => [String(s._id), s.openingHours ?? []]));

  const map = new Map<string, Interval[]>();
  for (const h of hours) {
    const salonId = h.salonId ? String(h.salonId) : null;
    const intervals = salonId
      ? clipToOpeningHours({ start: h.start, end: h.end }, h.dayOfWeek, openingBySalon.get(salonId))
      : [{ start: h.start, end: h.end }];
    if (intervals.length === 0) continue;
    const k = keyOf(h.dayOfWeek, salonId);
    map.set(k, [...(map.get(k) ?? []), ...intervals]);
  }
  return map;
}

/** True when a reservation no longer fits inside the stylist's effective hours. */
function isOutOfHours(r: IReservation, effective: Map<string, Interval[]>): boolean {
  const dayOfWeek = r.date.getUTCDay();
  const salonId = r.salonId ? String(r.salonId) : null;
  const intervals = effective.get(keyOf(dayOfWeek, salonId)) ?? [];
  const slot: Interval = { start: r.startTime, end: r.endTime };
  return !intervals.some((iv) => contains(iv, slot));
}

/**
 * Future active (pending/confirmed) reservations for this stylist that fall
 * outside their CURRENT effective hours. Sorted soonest-first.
 */
export async function findAffectedFutureReservations(stylistId: string): Promise<IReservation[]> {
  const effective = await buildEffectiveHours(stylistId);
  const future = await Reservation.find({
    stylistId,
    status: { $in: ['pending', 'confirmed'] },
    startAt: { $gte: new Date() },
  }).sort({ startAt: 1 });
  return future.filter((r) => isOutOfHours(r, effective));
}

/** IDs (as strings) of the stylist's out-of-hours future reservations. */
export async function affectedReservationIds(stylistId: string): Promise<Set<string>> {
  const affected = await findAffectedFutureReservations(stylistId);
  return new Set(affected.map((r) => String(r._id)));
}

/**
 * Recompute one stylist's out-of-hours reservations, sync the
 * `needsHoursUpdate` flag, and notify the stylist when the flag is newly
 * raised. Never cancels anything. Returns the affected reservations.
 */
export async function reconcileStylistHours(stylistId: string): Promise<IReservation[]> {
  const affected = await findAffectedFutureReservations(stylistId);
  const shouldFlag = affected.length > 0;

  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (profile && profile.needsHoursUpdate !== shouldFlag) {
    profile.needsHoursUpdate = shouldFlag;
    await profile.save();
    // Warn only on the false→true transition (avoid repeat spam on each edit).
    if (shouldFlag) {
      const user = await User.findById(stylistId).select('phone').lean();
      if (user?.phone) {
        void notificationService.workingHoursNeedReview(user.phone, { count: affected.length });
      }
    }
  }
  return affected;
}

/**
 * A salon owner changed the salon's opening hours: reconcile every stylist who
 * works there (active or pending membership). Best-effort per stylist.
 */
export async function reconcileSalonHoursChange(salonId: string): Promise<void> {
  if (!Types.ObjectId.isValid(salonId)) return;
  const links = await StylistSalon.find({
    salonId,
    status: { $in: ['active', 'pending'] },
  })
    .select('stylistId')
    .lean();
  for (const link of links) {
    await reconcileStylistHours(String(link.stylistId));
  }
}
