/**
 * Public (customer-facing) stylist discovery: search, profile and availability.
 * No authentication required — only ACTIVE stylists are exposed.
 */
import { Types } from 'mongoose';
import { User } from '../../models/User';
import { Service, IService } from '../../models/Service';
import { ServiceCategory } from '../../models/ServiceCategory';
import { StylistProfile } from '../../models/StylistProfile';
import { StylistService } from '../../models/StylistService';
import { StylistSalon } from '../../models/StylistSalon';
import { Salon, ISalon } from '../../models/Salon';
import { WorkingHour } from '../../models/WorkingHour';
import { Reservation } from '../../models/Reservation';
import { AppError } from '../../utils/AppError';
import { GeoPoint } from '../../utils/geo';
import { storageProvider } from '../../utils/storage';
import { Interval } from '../../utils/time';
import { buildSlots, iranNow, WorkingInterval } from '../../utils/slots';

/** Effective price/duration: stylist override falls back to the service default. */
export function effectivePrice(override: number | null, svc: IService): number {
  return override ?? svc.defaultPrice;
}
export function effectiveDuration(override: number | null, svc: IService): number {
  return override ?? svc.durationMin;
}

function photoUrl(key?: string | null): string | null {
  return key ? storageProvider.getUrl(key) : null;
}

/** Whether a stylist's paid promotion is currently active (Iran-fixed clock). */
export function isPromotedActive(p: {
  isPromoted?: boolean;
  promotedUntil?: Date | null;
}): boolean {
  return !!p.isPromoted && !!p.promotedUntil && new Date(p.promotedUntil).getTime() > Date.now();
}

/** Distance in meters between two [lng, lat] points (haversine). */
function distanceMeters(a: [number, number], b: [number, number]): number {
  const R = 6371000;
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b[1] - a[1]);
  const dLng = toRad(b[0] - a[0]);
  const lat1 = toRad(a[1]);
  const lat2 = toRad(b[1]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

interface SearchParams {
  serviceId?: string;
  categoryId?: string;
  name?: string;
  lng?: number;
  lat?: number;
  radius?: number; // meters
}

/**
 * The salon a stylist works in (for location + display), if any. Uses the
 * first active-or-pending membership (rejected memberships are ignored) and
 * returns its membership status so the client can label "pending approval".
 */
async function resolveStylistLocation(
  userId: string,
  profile: { workplaceType?: string; freelance?: { address?: string; location?: GeoPoint } },
): Promise<{
  location: GeoPoint | null;
  address: string | null;
  salon: ISalon | null;
  salonStatus: 'active' | 'pending' | null;
}> {
  if (profile.workplaceType === 'freelance' && profile.freelance?.location) {
    return {
      location: profile.freelance.location,
      address: profile.freelance.address ?? null,
      salon: null,
      salonStatus: null,
    };
  }

  const link = await StylistSalon.findOne({
    stylistId: userId,
    status: { $in: ['active', 'pending'] },
  })
    .populate<{ salonId: ISalon }>('salonId')
    .sort({ status: 1, createdAt: 1 }); // 'active' sorts before 'pending'
  const salon = (link?.salonId as unknown as ISalon | null) ?? null;
  return {
    location: salon?.location ?? null,
    address: salon?.address ?? null,
    salon,
    salonStatus: (link?.status as 'active' | 'pending' | undefined) ?? null,
  };
}

export async function searchStylists(params: SearchParams) {
  // 1) Start from active stylist profiles that currently accept reservations.
  const profiles = await StylistProfile.find({
    status: 'active',
    isAcceptingReservations: { $ne: false },
  }).lean();
  if (profiles.length === 0) return [];

  const stylistIds = profiles.map((p) => p.userId);

  // 2) Load the related users, their services and salon memberships in bulk.
  const [users, stylistServices, allServices] = await Promise.all([
    User.find({ _id: { $in: stylistIds } })
      .select('firstName lastName profilePhoto')
      .lean(),
    StylistService.find({ stylistId: { $in: stylistIds } }).lean(),
    Service.find().lean(),
  ]);

  const serviceById = new Map(allServices.map((s) => [String(s._id), s as unknown as IService]));
  const userById = new Map(users.map((u) => [String(u._id), u]));

  // Optional category filter resolves to a set of serviceIds.
  let categoryServiceIds: Set<string> | null = null;
  if (params.categoryId) {
    const inCat = allServices.filter((s) => String(s.categoryId) === params.categoryId);
    categoryServiceIds = new Set(inCat.map((s) => String(s._id)));
  }

  const results = [];
  for (const profile of profiles) {
    const uid = String(profile.userId);
    const user = userById.get(uid);
    if (!user) continue;

    const myServices = stylistServices.filter((s) => String(s.stylistId) === uid);
    if (myServices.length === 0) continue;

    // serviceId filter.
    if (params.serviceId && !myServices.some((s) => String(s.serviceId) === params.serviceId)) {
      continue;
    }
    // categoryId filter.
    if (
      categoryServiceIds &&
      !myServices.some((s) => categoryServiceIds!.has(String(s.serviceId)))
    ) {
      continue;
    }
    // name filter.
    if (params.name) {
      const full = `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim();
      if (!full.toLowerCase().includes(params.name.toLowerCase())) continue;
    }

    const loc = await resolveStylistLocation(uid, profile);

    // geo filter.
    if (params.lng !== undefined && params.lat !== undefined) {
      if (!loc.location) continue;
      const d = distanceMeters(loc.location.coordinates, [params.lng, params.lat]);
      if (d > (params.radius ?? 5000)) continue;
    }

    const services = myServices
      .map((ss) => {
        const svc = serviceById.get(String(ss.serviceId));
        if (!svc) return null;
        return {
          id: String(ss.serviceId),
          name: svc.name,
          price: effectivePrice(ss.price, svc),
          durationMin: effectiveDuration(ss.durationMin, svc),
        };
      })
      .filter(Boolean);

    results.push({
      id: uid,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      fullName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'متخصص',
      profilePhoto: photoUrl(user.profilePhoto),
      workplaceType: profile.workplaceType ?? null,
      location: loc.location,
      address: loc.address,
      salon: loc.salon
        ? { id: String(loc.salon._id), name: loc.salon.name, status: loc.salonStatus }
        : null,
      services,
      portfolio: (profile.portfolio ?? []).slice(0, 4).map((p) => storageProvider.getUrl(p)),
      rating: profile.ratingAverage ?? 0,
      ratingCount: profile.ratingCount ?? 0,
      isPromoted: isPromotedActive(profile),
    });
  }

  // Ranking: promoted stylists first, then by rating (desc). Within a group,
  // ties keep their natural order.
  results.sort((a, b) => {
    if (a.isPromoted !== b.isPromoted) return a.isPromoted ? -1 : 1;
    return (b.rating ?? 0) - (a.rating ?? 0);
  });

  return results;
}

/** Active, currently-promoted stylists for the landing "featured" section. */
export async function getFeaturedStylists() {
  const all = await searchStylists({});
  return all.filter((s) => s.isPromoted);
}

export async function getStylistProfile(stylistId: string) {
  if (!Types.ObjectId.isValid(stylistId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const profile = await StylistProfile.findOne({ userId: stylistId }).lean();
  if (!profile || profile.status !== 'active') {
    throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  }

  const [user, stylistServices, categories, allServices, salonLinks] = await Promise.all([
    User.findById(stylistId).select('firstName lastName profilePhoto').lean(),
    StylistService.find({ stylistId }).lean(),
    ServiceCategory.find().sort({ order: 1 }).lean(),
    Service.find().lean(),
    StylistSalon.find({ stylistId, status: { $in: ['active', 'pending'] } })
      .populate<{ salonId: ISalon }>('salonId')
      .lean(),
  ]);
  if (!user) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');

  const serviceById = new Map(allServices.map((s) => [String(s._id), s as unknown as IService]));
  const catById = new Map(categories.map((c) => [String(c._id), c]));

  const services = stylistServices
    .map((ss) => {
      const svc = serviceById.get(String(ss.serviceId));
      if (!svc) return null;
      const cat = catById.get(String(svc.categoryId));
      return {
        id: String(ss.serviceId),
        name: svc.name,
        description: svc.description ?? null,
        price: effectivePrice(ss.price, svc),
        durationMin: effectiveDuration(ss.durationMin, svc),
        category: cat ? { id: String(cat._id), name: cat.name } : null,
      };
    })
    .filter(Boolean);

  const salons = salonLinks
    .map((l) => {
      const s = l.salonId as unknown as ISalon | null;
      return s
        ? {
            id: String(s._id),
            name: s.name,
            address: s.address ?? null,
            location: s.location ?? null,
            // The stylist's membership status in this salon (active|pending).
            status: l.status,
          }
        : null;
    })
    .filter(Boolean);

  return {
    id: stylistId,
    firstName: user.firstName ?? null,
    lastName: user.lastName ?? null,
    fullName: `${user.firstName ?? ''} ${user.lastName ?? ''}`.trim() || 'متخصص',
    profilePhoto: photoUrl(user.profilePhoto),
    workplaceType: profile.workplaceType ?? null,
    freelance: profile.freelance
      ? { address: profile.freelance.address ?? null, location: profile.freelance.location ?? null }
      : null,
    portfolio: (profile.portfolio ?? []).map((p) => storageProvider.getUrl(p)),
    services,
    salons,
    rating: profile.ratingAverage ?? 0,
    ratingCount: profile.ratingCount ?? 0,
    isPromoted: isPromotedActive(profile),
    isAcceptingReservations: profile.isAcceptingReservations !== false,
  };
}

/** Max number of days ahead a customer may book (booking horizon). */
export const MAX_BOOKING_DAYS = 60;

/** "YYYY-MM-DD" + n days (UTC arithmetic; dates model Iran calendar days). */
function addDaysIso(iso: string, n: number): string {
  const d = new Date(`${iso}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Validate the stylist offers exactly the requested services and return their
 * combined effective duration (minutes). Throws on missing services.
 */
async function resolveTotalDuration(stylistId: string, serviceIds: string[]): Promise<number> {
  const stylistServices = await StylistService.find({
    stylistId,
    serviceId: { $in: serviceIds },
  }).lean();
  if (stylistServices.length !== new Set(serviceIds).size) {
    throw AppError.badRequest('یک یا چند سرویس برای این متخصص موجود نیست', 'SERVICE_NOT_OFFERED');
  }
  const services = await Service.find({ _id: { $in: serviceIds } }).lean();
  const svcById = new Map(services.map((s) => [String(s._id), s as unknown as IService]));
  let totalDuration = 0;
  for (const ss of stylistServices) {
    const svc = svcById.get(String(ss.serviceId));
    if (svc) totalDuration += effectiveDuration(ss.durationMin, svc);
  }
  if (totalDuration <= 0) {
    throw AppError.badRequest('مدت سرویس نامعتبر است', 'INVALID_DURATION');
  }
  return totalDuration;
}

async function ensureActiveStylist(stylistId: string) {
  if (!Types.ObjectId.isValid(stylistId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const profile = await StylistProfile.findOne({ userId: stylistId }).lean();
  if (!profile || profile.status !== 'active') {
    throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  }
  return profile;
}

/**
 * Available booking slots for a stylist on a given Iran calendar day, for the
 * combined duration of the chosen services. Returns an empty `slots` array
 * (never an error) when the stylist doesn't work that day or nothing is free.
 * Each slot: { start, end, startTime, endTime, salonId, salonName, salon }.
 */
export async function getAvailability(stylistId: string, dateStr: string, serviceIds: string[]) {
  const profile = await ensureActiveStylist(stylistId);
  // Paused stylists expose no slots (existing reservations are untouched).
  if (profile.isAcceptingReservations === false) {
    return { date: dateStr, dayOfWeek: -1, totalDurationMin: 0, slots: [] };
  }
  const totalDuration = await resolveTotalDuration(stylistId, serviceIds);

  // Iran day → day-of-week. dateStr is "YYYY-MM-DD" representing an Iran day.
  const dayDate = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(dayDate.getTime())) {
    throw AppError.badRequest('تاریخ نامعتبر است', 'INVALID_DATE');
  }
  const dayOfWeek = dayDate.getUTCDay();

  // Membership status per salon (to label slots and exclude rejected ones).
  const memberships = await StylistSalon.find({ stylistId }).lean();
  const statusBySalon = new Map(memberships.map((m) => [String(m.salonId), m.status]));

  // Working intervals for that weekday, with salon labels. Rejected-salon
  // intervals are excluded; pending salons are bookable.
  const hours = await WorkingHour.find({ stylistId, dayOfWeek })
    .populate<{ salonId: ISalon | null }>('salonId')
    .sort({ start: 1 });

  const working: WorkingInterval[] = hours
    .filter((h) => !h.salonId || statusBySalon.get(String(h.salonId)) !== 'rejected')
    .map((h) => {
      const salon = h.salonId as unknown as ISalon | null;
      return {
        start: h.start,
        end: h.end,
        salonId: salon ? String(salon._id) : null,
        salon: salon ? { id: String(salon._id), name: salon.name } : null,
      };
    });

  // Already-booked intervals for the day (pending/confirmed block the slot).
  const dayReservations = await Reservation.find({
    stylistId,
    date: dayDate,
    status: { $in: ['pending', 'confirmed'] },
  }).lean();
  const busy: Interval[] = dayReservations.map((r) => ({ start: r.startTime, end: r.endTime }));

  // If the requested day is today (Iran), forbid past start times.
  const now = iranNow();
  const minStart = now.date === dateStr ? now.minutes : 0;

  const rawSlots = buildSlots(working, totalDuration, busy, 15, minStart);
  // Enrich for the frontend datepicker/timepicker (incl. salon membership status).
  const slots = rawSlots.map((s) => ({
    start: s.startTime,
    end: s.endTime,
    startTime: s.startTime,
    endTime: s.endTime,
    salonId: s.salonId,
    salonName: s.salon?.name ?? null,
    salonStatus: s.salonId ? statusBySalon.get(s.salonId) ?? null : null,
    salon: s.salon,
  }));

  return {
    date: dateStr,
    dayOfWeek,
    totalDurationMin: totalDuration,
    slots,
  };
}

/**
 * Days (Gregorian "YYYY-MM-DD") within [from, to] that have at least one free
 * slot for the chosen services — for disabling empty days in a datepicker.
 * Respects the booking horizon and never returns past days. All-in-memory after
 * two bulk queries (working hours + reservations in range).
 */
export async function getAvailableDays(
  stylistId: string,
  from: string,
  to: string,
  serviceIds: string[],
) {
  const profile = await ensureActiveStylist(stylistId);
  if (profile.isAcceptingReservations === false) {
    return { from, to, days: [] as string[] };
  }
  const totalDuration = await resolveTotalDuration(stylistId, serviceIds);

  const today = iranNow();
  // Clamp the window: not before today, not past the booking horizon.
  const start = from < today.date ? today.date : from;
  const horizonEnd = addDaysIso(today.date, MAX_BOOKING_DAYS);
  const end = to > horizonEnd ? horizonEnd : to;

  const days: string[] = [];
  if (start > end) return { from: start, to: end, days };

  // Membership status per salon (to exclude rejected-salon intervals).
  const memberships = await StylistSalon.find({ stylistId }).lean();
  const statusBySalon = new Map(memberships.map((m) => [String(m.salonId), m.status]));

  // Bulk-load working hours grouped by weekday.
  const hours = await WorkingHour.find({ stylistId }).lean();
  const workingByDay = new Map<number, WorkingInterval[]>();
  for (const h of hours) {
    const salonId = h.salonId ? String(h.salonId) : null;
    if (salonId && statusBySalon.get(salonId) === 'rejected') continue;
    const list = workingByDay.get(h.dayOfWeek) ?? [];
    list.push({ start: h.start, end: h.end, salonId, salon: null });
    workingByDay.set(h.dayOfWeek, list);
  }

  // Bulk-load reservations across the window, grouped by their Iran day.
  const rangeStart = new Date(`${start}T00:00:00.000Z`);
  const rangeEnd = new Date(`${end}T00:00:00.000Z`);
  const reservations = await Reservation.find({
    stylistId,
    date: { $gte: rangeStart, $lte: rangeEnd },
    status: { $in: ['pending', 'confirmed'] },
  }).lean();
  const busyByDay = new Map<string, Interval[]>();
  for (const r of reservations) {
    const key = r.date.toISOString().slice(0, 10);
    const list = busyByDay.get(key) ?? [];
    list.push({ start: r.startTime, end: r.endTime });
    busyByDay.set(key, list);
  }

  for (let iso = start; iso <= end; iso = addDaysIso(iso, 1)) {
    const dayOfWeek = new Date(`${iso}T00:00:00.000Z`).getUTCDay();
    const working = workingByDay.get(dayOfWeek);
    if (!working || working.length === 0) continue;
    const busy = busyByDay.get(iso) ?? [];
    const minStart = today.date === iso ? today.minutes : 0;
    const slots = buildSlots(working, totalDuration, busy, 15, minStart);
    if (slots.length > 0) days.push(iso);
  }

  return { from: start, to: end, days };
}
