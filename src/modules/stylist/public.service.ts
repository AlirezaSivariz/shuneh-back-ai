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
import { Salon, ISalon, salonMatchesGender } from '../../models/Salon';
import { WorkingHour } from '../../models/WorkingHour';
import { Reservation } from '../../models/Reservation';
import { AppError } from '../../utils/AppError';
import { GeoPoint } from '../../utils/geo';
import { storageProvider } from '../../utils/storage';
import { Interval } from '../../utils/time';
import { buildSlots, iranNow, WorkingInterval } from '../../utils/slots';
import { getBookability, getBookabilityMap } from './bookability';
import { clipToOpeningHours } from './hoursReconcile';
import { getActivePromotionMap, isContextPromoted, isAnyPromoted } from './promotions';
import {
  resolveCancellationPolicy,
  serializePolicy,
  resolvePerServicePolicies,
} from '../policy/policy.service';

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

/**
 * The cancellation/reschedule policy that WOULD apply to a prospective booking
 * (for the booking-confirm screen). Resolves stylist-per-service → stylist →
 * salon → system. `salonId` is optional; when omitted the stylist's primary
 * active salon is used so the customer still sees meaningful terms.
 */
export async function getStylistBookingPolicy(
  stylistId: string,
  serviceIds: string[],
  salonId?: string | null,
) {
  let resolvedSalonId = salonId ?? null;
  if (!resolvedSalonId) {
    const link = await StylistSalon.findOne({ stylistId, status: 'active' }).select('salonId').lean();
    resolvedSalonId = link ? String(link.salonId) : null;
  }
  const resolved = await resolveCancellationPolicy({
    stylistId,
    salonId: resolvedSalonId,
    serviceIds: serviceIds ?? [],
  });
  return serializePolicy(resolved);
}

/**
 * Booking-time policy WITH a per-service breakdown — so the booking modal can
 * show each service's final policy when they differ. `uniform` tells the client
 * whether a single box suffices.
 */
export async function getStylistBookingPolicyBreakdown(
  stylistId: string,
  serviceIds: string[],
  salonId?: string | null,
) {
  let resolvedSalonId = salonId ?? null;
  if (!resolvedSalonId) {
    const link = await StylistSalon.findOne({ stylistId, status: 'active' }).select('salonId').lean();
    resolvedSalonId = link ? String(link.salonId) : null;
  }
  const { uniform, services, common } = await resolvePerServicePolicies({
    stylistId,
    salonId: resolvedSalonId,
    serviceIds: serviceIds ?? [],
  });
  return {
    uniform,
    policy: serializePolicy(common),
    services: services.map((s) => ({
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      policy: serializePolicy(s.policy),
    })),
  };
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
  province?: string;
  city?: string;
  lng?: number;
  lat?: number;
  radius?: number; // meters
  gender?: 'women' | 'men';
  /**
   * Optional Iran calendar day "YYYY-MM-DD". When set, only stylists with at
   * least one free slot that day are returned, and each carries `availableThatDay`
   * ({count, firstSlot}). Computed in bulk (≈3 queries total) so it stays cheap
   * even with many stylists.
   */
  date?: string;
}

/** Per-stylist inputs needed to test "has a free slot on a given day" in bulk. */
interface DayAvailabilityMeta {
  stylistId: string;
  minDuration: number;
  activeSalonIds: string[];
  freelance: boolean;
}

/**
 * For each stylist, whether they have ≥1 bookable slot on `dateStr` (using their
 * SHORTEST service as the probe duration = "has any capacity"). Bulk: one
 * working-hours query, one salon-opening-hours query, one reservations query —
 * regardless of stylist count. Mirrors `getAvailability`'s clipping/now rules.
 */
async function computeDayAvailability(
  meta: DayAvailabilityMeta[],
  dateStr: string,
): Promise<Map<string, { count: number; firstSlot: string | null }>> {
  const out = new Map<string, { count: number; firstSlot: string | null }>();
  if (meta.length === 0) return out;

  const dayDate = new Date(`${dateStr}T00:00:00.000Z`);
  if (Number.isNaN(dayDate.getTime())) return out;
  const dayOfWeek = dayDate.getUTCDay();
  const ids = meta.map((m) => m.stylistId);

  const hours = await WorkingHour.find({ stylistId: { $in: ids }, dayOfWeek }).lean();
  const salonIds = [...new Set(hours.map((h) => h.salonId).filter(Boolean).map(String))];
  const salons = salonIds.length
    ? await Salon.find({ _id: { $in: salonIds } }).select('openingHours').lean()
    : [];
  const openingBySalon = new Map(salons.map((s) => [String(s._id), s.openingHours ?? []]));

  const reservations = await Reservation.find({
    stylistId: { $in: ids },
    date: dayDate,
    status: { $in: ['pending', 'confirmed'] },
  })
    .select('stylistId startTime endTime')
    .lean();
  const busyByStylist = new Map<string, Interval[]>();
  for (const r of reservations) {
    const sid = String(r.stylistId);
    const list = busyByStylist.get(sid) ?? [];
    list.push({ start: r.startTime, end: r.endTime });
    busyByStylist.set(sid, list);
  }

  const hoursByStylist = new Map<string, typeof hours>();
  for (const h of hours) {
    const sid = String(h.stylistId);
    const list = hoursByStylist.get(sid) ?? [];
    list.push(h);
    hoursByStylist.set(sid, list);
  }

  const now = iranNow();
  const minStart = now.date === dateStr ? now.minutes : 0;

  for (const m of meta) {
    const activeSet = new Set(m.activeSalonIds);
    const working: WorkingInterval[] = (hoursByStylist.get(m.stylistId) ?? [])
      .filter((h) => (h.salonId ? activeSet.has(String(h.salonId)) : m.freelance))
      .flatMap((h) => {
        const salonId = h.salonId ? String(h.salonId) : null;
        const parts = salonId
          ? clipToOpeningHours({ start: h.start, end: h.end }, dayOfWeek, openingBySalon.get(salonId))
          : [{ start: h.start, end: h.end }];
        return parts.map((p) => ({ start: p.start, end: p.end, salonId, salon: null }));
      });
    if (working.length === 0) continue;
    const busy = busyByStylist.get(m.stylistId) ?? [];
    const slots = buildSlots(working, m.minDuration, busy, 15, minStart);
    if (slots.length > 0) out.set(m.stylistId, { count: slots.length, firstSlot: slots[0].startTime });
  }
  return out;
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
  // Only stylists with an active workplace are bookable → shown in search.
  const bookMap = await getBookabilityMap(profiles);

  // Optional category filter resolves to a set of serviceIds.
  let categoryServiceIds: Set<string> | null = null;
  if (params.categoryId) {
    const inCat = allServices.filter((s) => String(s.categoryId) === params.categoryId);
    categoryServiceIds = new Set(inCat.map((s) => String(s._id)));
  }

  const results = [];
  // Per-stylist inputs for the optional day-availability filter (date param).
  const availabilityMeta: DayAvailabilityMeta[] = [];
  for (const profile of profiles) {
    const uid = String(profile.userId);
    const user = userById.get(uid);
    if (!user) continue;

    // Not bookable (no active workplace) → never appears in search/featured.
    if (!bookMap.get(uid)?.bookable) continue;

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

    // province/city filter: matches the stylist's salon location. Freelancers
    // (no salon) carry no province/city and are excluded when either is set.
    if (params.province && loc.salon?.province !== params.province) continue;
    if (params.city && loc.salon?.city !== params.city) continue;

    // geo filter.
    if (params.lng !== undefined && params.lat !== undefined) {
      if (!loc.location) continue;
      const d = distanceMeters(loc.location.coordinates, [params.lng, params.lat]);
      if (d > (params.radius ?? 5000)) continue;
    }

    // gender filter: the stylist must work at a salon serving that gender. A
    // freelancer (no salon) has no gender and is excluded when a filter is set.
    if (params.gender) {
      if (!loc.salon || !salonMatchesGender(loc.salon.serviceGender, params.gender)) continue;
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
        ? {
            id: String(loc.salon._id),
            name: loc.salon.name,
            status: loc.salonStatus,
            serviceGender: loc.salon.serviceGender ?? null,
            province: loc.salon.province ?? null,
            city: loc.salon.city ?? null,
          }
        : null,
      services,
      portfolio: (profile.portfolio ?? []).slice(0, 4).map((p) => storageProvider.getUrl(p)),
      rating: profile.ratingAverage ?? 0,
      ratingCount: profile.ratingCount ?? 0,
      // Context-promoted flag is filled after the loop (needs the promo map).
      isPromoted: false,
      isVerified: profile.isVerified === true,
      // Day-availability ({count, firstSlot}) — only populated when `date` is set.
      availableThatDay: null as { count: number; firstSlot: string | null } | null,
      // Registration time — used only by the home fallback ranking (tie-break
      // by newest). Not sensitive; clients may ignore it.
      createdAt: profile.createdAt ?? null,
    });

    const book = bookMap.get(uid);
    availabilityMeta.push({
      stylistId: uid,
      minDuration: services.length ? Math.min(...services.map((s) => s!.durationMin)) : 15,
      activeSalonIds: book?.activeSalonIds ?? [],
      freelance: book?.freelance ?? false,
    });
  }

  // Promotions: a stylist is "promoted" in THIS context — when a category filter
  // is active, only its category promotion counts; otherwise the general one.
  const promoMap = await getActivePromotionMap(results.map((r) => r.id));
  for (const r of results) {
    r.isPromoted = isContextPromoted(promoMap.get(r.id), params.categoryId);
  }

  // Optional "available on this day" filter (bulk; keeps only stylists with a
  // free slot that day and annotates each with the count + first slot).
  let final = results;
  if (params.date) {
    const avail = await computeDayAvailability(availabilityMeta, params.date);
    final = results.filter((r) => avail.has(r.id));
    for (const r of final) r.availableThatDay = avail.get(r.id) ?? null;
  }

  // Ranking: promoted stylists first, then by rating (desc). Within a group,
  // ties keep their natural order.
  final.sort((a, b) => {
    if (a.isPromoted !== b.isPromoted) return a.isPromoted ? -1 : 1;
    return (b.rating ?? 0) - (a.rating ?? 0);
  });

  return final;
}

/** Active, currently-promoted stylists for the landing "featured" section. */
export async function getFeaturedStylists() {
  const all = await searchStylists({});
  return all.filter((s) => s.isPromoted);
}

/** Default and maximum number of stylists the landing "home" section returns. */
const HOME_DEFAULT_LIMIT = 6;
const HOME_MAX_LIMIT = 24;

/**
 * Stylists for the landing page "متخصصین" section, with a fallback so the
 * section is never empty while any bookable stylist exists. Ordering:
 *   1) active-promoted stylists (isPromoted && promotedUntil > now), then
 *   2) the remaining bookable stylists by best rating, then newest registration.
 * Only bookable stylists are considered (searchStylists already enforces an
 * active workplace + accepting reservations). Each item is tagged `isPromoted`
 * (real promotion) and `isFallback` (filled the slot only because there weren't
 * enough promoted ones) so the client can label "ویژه" optionally.
 */
export async function getHomeStylists(limit?: number) {
  const take = Math.min(Math.max(1, Math.floor(limit ?? HOME_DEFAULT_LIMIT)), HOME_MAX_LIMIT);
  const all = await searchStylists({});

  const promoted = all.filter((s) => s.isPromoted);
  const fallback = all
    .filter((s) => !s.isPromoted)
    .sort((a, b) => {
      const byRating = (b.rating ?? 0) - (a.rating ?? 0);
      if (byRating !== 0) return byRating;
      // Tie-break: newest registration first (keeps the lineup fresh).
      const at = a.createdAt ? new Date(a.createdAt).getTime() : 0;
      const bt = b.createdAt ? new Date(b.createdAt).getTime() : 0;
      return bt - at;
    });

  // promoted first (already rating-sorted by searchStylists), then fallbacks.
  return [...promoted, ...fallback].slice(0, take).map(({ createdAt, ...s }) => {
    void createdAt; // internal-only ranking field; not part of the card payload.
    return { ...s, isFallback: !s.isPromoted };
  });
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
            province: s.province ?? null,
            city: s.city ?? null,
            location: s.location ?? null,
            // The stylist's membership status in this salon (active|pending).
            status: l.status,
          }
        : null;
    })
    .filter(Boolean);

  // "ویژه" badge on the profile when the stylist has ANY active promotion.
  const promoEntry = (await getActivePromotionMap([stylistId])).get(stylistId);

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
    isPromoted: isAnyPromoted(promoEntry),
    isAcceptingReservations: profile.isAcceptingReservations !== false,
    isVerified: profile.isVerified === true,
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
export async function getAvailability(
  stylistId: string,
  dateStr: string,
  serviceIds: string[],
  excludeReservationId?: string,
) {
  const profile = await ensureActiveStylist(stylistId);
  // Not bookable (paused, or no active workplace) → no slots. Existing
  // reservations are untouched.
  const book = await getBookability(stylistId, profile);
  if (!book.bookable) {
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

  // Only ACTIVE workplaces are bookable: freelance intervals (no salon) count
  // only if the stylist is a freelancer; salon intervals only for active salons.
  // NB: h.salonId is POPULATED here (a Salon doc), so read its _id, not String(h.salonId).
  const activeSalonSet = new Set(book.activeSalonIds);
  const working: WorkingInterval[] = hours
    .filter((h) => {
      const salon = h.salonId as unknown as ISalon | null;
      return salon ? activeSalonSet.has(String(salon._id)) : book.freelance;
    })
    .flatMap((h) => {
      const salon = h.salonId as unknown as ISalon | null;
      const salonId = salon ? String(salon._id) : null;
      const label = salon ? { id: salonId as string, name: salon.name } : null;
      // Re-validate against the salon's CURRENT opening hours: clip salon-bound
      // intervals so a later narrowing of the salon's hours never surfaces (or
      // lets anyone book) an out-of-hours slot. Freelance intervals pass through.
      const parts = salon
        ? clipToOpeningHours({ start: h.start, end: h.end }, dayOfWeek, salon.openingHours)
        : [{ start: h.start, end: h.end }];
      return parts.map((p) => ({ start: p.start, end: p.end, salonId, salon: label }));
    });

  // Already-booked intervals for the day (pending/confirmed block the slot).
  // When rescheduling, the reservation being moved must NOT block itself.
  const busyQuery: Record<string, unknown> = {
    stylistId,
    date: dayDate,
    status: { $in: ['pending', 'confirmed'] },
  };
  if (excludeReservationId && Types.ObjectId.isValid(excludeReservationId)) {
    busyQuery._id = { $ne: new Types.ObjectId(excludeReservationId) };
  }
  const dayReservations = await Reservation.find(busyQuery).lean();
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
  const book = await getBookability(stylistId, profile);
  if (!book.bookable) {
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

  // Only ACTIVE workplaces produce bookable days.
  const activeSalonSet = new Set(book.activeSalonIds);

  // Current opening hours of the active salons, to clip stale stylist hours
  // (same re-validation as getAvailability — narrowed salon hours never leak).
  const salonDocs = book.activeSalonIds.length
    ? await Salon.find({ _id: { $in: book.activeSalonIds } }).select('openingHours').lean()
    : [];
  const openingBySalon = new Map(salonDocs.map((s) => [String(s._id), s.openingHours ?? []]));

  // Bulk-load working hours grouped by weekday.
  const hours = await WorkingHour.find({ stylistId }).lean();
  const workingByDay = new Map<number, WorkingInterval[]>();
  for (const h of hours) {
    const salonId = h.salonId ? String(h.salonId) : null;
    if (salonId ? !activeSalonSet.has(salonId) : !book.freelance) continue;
    const parts = salonId
      ? clipToOpeningHours({ start: h.start, end: h.end }, h.dayOfWeek, openingBySalon.get(salonId))
      : [{ start: h.start, end: h.end }];
    const list = workingByDay.get(h.dayOfWeek) ?? [];
    for (const p of parts) list.push({ start: p.start, end: p.end, salonId, salon: null });
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
