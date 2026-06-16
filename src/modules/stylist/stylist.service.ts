import { Types } from 'mongoose';
import { Service, IService } from '../../models/Service';
import { ServiceCategory } from '../../models/ServiceCategory';
import { StylistService } from '../../models/StylistService';
import { Salon, ISalon } from '../../models/Salon';
import { StylistSalon } from '../../models/StylistSalon';
import { WorkingHour } from '../../models/WorkingHour';
import { WorkplaceType, StylistProfile } from '../../models/StylistProfile';
import { Reservation } from '../../models/Reservation';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { toGeoPoint } from '../../utils/geo';
import { Interval, isOrdered, overlaps, contains } from '../../utils/time';
import { notificationService } from '../../utils/notification';
import { storageProvider } from '../../utils/storage';
import fs from 'fs';
import path from 'path';
import {
  ensureStylistProfile,
  advanceStep,
  getStylistProfile,
} from '../onboarding/onboarding.service';

interface ServiceItem {
  serviceId: string;
  price?: number | null;
  durationMin?: number | null;
}

/**
 * Step 2 — set the services a stylist offers. Upserts each StylistService and
 * removes ones no longer selected (full replace of the stylist's service set).
 */
export async function setServices(stylistId: string, items: ServiceItem[]) {
  const serviceIds = items.map((i) => i.serviceId);

  // Make sure every referenced service exists.
  const found = await Service.find({ _id: { $in: serviceIds } }).select('_id');
  if (found.length !== new Set(serviceIds).size) {
    throw AppError.badRequest('One or more services do not exist', 'SERVICE_NOT_FOUND');
  }

  // Upsert selected services.
  for (const item of items) {
    await StylistService.updateOne(
      { stylistId, serviceId: item.serviceId },
      {
        $set: {
          price: item.price ?? null,
          durationMin: item.durationMin ?? null,
        },
      },
      { upsert: true },
    );
  }

  // Remove de-selected services — but NEVER the stylist's custom services
  // (those are managed via the /services/custom endpoints, not this catalogue set).
  const keep = [...serviceIds, ...(await customServiceIds(stylistId))];
  await StylistService.deleteMany({ stylistId, serviceId: { $nin: keep } });

  // The step requires at least one service in TOTAL — a selected default OR a
  // custom service. Source of truth is the persisted set, so a stylist offering
  // only custom services (empty `items`) is valid.
  const total = await StylistService.countDocuments({ stylistId });
  if (total === 0) {
    throw AppError.badRequest('حداقل یک خدمت را انتخاب کنید', 'NO_SERVICES');
  }

  const profile = await ensureStylistProfile(stylistId);
  await advanceStep(profile, 'services');

  return StylistService.find({ stylistId }).populate('serviceId');
}

/** Step 3 — choose workplace type (freelance | salon). */
export async function setWorkplaceType(stylistId: string, type: WorkplaceType) {
  const profile = await ensureStylistProfile(stylistId);
  profile.workplaceType = type;
  await profile.save();
  return profile;
}

/** Step 3a — freelance address & location. Completes the workplace step. */
export async function setFreelance(
  stylistId: string,
  data: { address: string; lng: number; lat: number },
) {
  const profile = await ensureStylistProfile(stylistId);
  profile.workplaceType = 'freelance';
  profile.freelance = {
    address: data.address,
    location: toGeoPoint(data.lng, data.lat),
  };
  await profile.save();
  await advanceStep(profile, 'workplace');
  return profile;
}

/** Step 3b — join an existing salon (membership pending owner approval). */
export async function joinSalon(stylistId: string, salonId: string) {
  const salon = await Salon.findById(salonId);
  if (!salon) throw AppError.notFound('Salon not found', 'SALON_NOT_FOUND');

  const existing = await StylistSalon.findOne({ stylistId, salonId });
  if (existing) {
    throw AppError.conflict('Already linked to this salon', 'ALREADY_LINKED');
  }

  const link = await StylistSalon.create({
    stylistId: new Types.ObjectId(stylistId),
    salonId: new Types.ObjectId(salonId),
    status: 'pending',
  });

  const profile = await ensureStylistProfile(stylistId);
  profile.workplaceType = 'salon';
  await profile.save();
  await advanceStep(profile, 'workplace');

  return link;
}

/**
 * List every salon the stylist is linked to, with the membership status
 * (active / pending) and the salon details. Supports working in many salons.
 */
export async function listStylistSalons(stylistId: string) {
  const links = await StylistSalon.find({ stylistId })
    .populate<{ salonId: ISalon }>('salonId')
    .sort({ createdAt: 1 });

  return links.map((link) => {
    const salon = link.salonId as unknown as ISalon | null;
    return {
      membershipId: String(link._id),
      status: link.status,
      salon: salon
        ? {
            id: String(salon._id),
            name: salon.name,
            address: salon.address,
            status: salon.status,
            openingHours: salon.openingHours,
          }
        : null,
    };
  });
}

/**
 * Leave a salon. By default refuses (409) if the stylist has FUTURE confirmed
 * reservations there, returning the affected list. With `force`, those
 * reservations are cancelled (cancelledBy='stylist', reason='stylist_left_salon')
 * and the customers are notified (best-effort). In all success cases the
 * membership and the stylist's working hours for that salon are removed so no
 * orphan hours remain.
 */
export async function leaveSalon(stylistId: string, salonId: string, force = false) {
  if (!Types.ObjectId.isValid(salonId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const link = await StylistSalon.findOne({ stylistId, salonId });
  if (!link) {
    throw AppError.notFound('شما عضو این سالن نیستید', 'SALON_NOT_LINKED');
  }

  // Future confirmed reservations at this salon for this stylist.
  const affected = await Reservation.find({
    stylistId,
    salonId,
    status: 'confirmed',
    startAt: { $gte: new Date() },
  })
    .sort({ startAt: 1 })
    .lean();

  if (affected.length > 0 && !force) {
    throw new AppError(
      409,
      `برای خروج از این سالن، ابتدا باید ${affected.length} رزرو فعالِ آینده تعیین‌تکلیف شود.`,
      'SALON_HAS_ACTIVE_RESERVATIONS',
      {
        affectedReservations: affected.map((r) => ({
          id: String(r._id),
          date: r.date.toISOString().slice(0, 10),
          startTime: r.startTime,
        })),
      },
    );
  }

  // Cancel the affected reservations atomically (force path).
  if (affected.length > 0) {
    const ids = affected.map((r) => r._id);
    await Reservation.updateMany(
      { _id: { $in: ids } },
      { $set: { status: 'cancelled', cancelledBy: 'stylist', cancelReason: 'stylist_left_salon' } },
    );
    // Notify the customers (best-effort; never blocks the leave operation).
    void (async () => {
      const customers = await User.find({
        _id: { $in: affected.map((r) => r.customerId) },
      })
        .select('phone')
        .lean();
      const phoneById = new Map(customers.map((u) => [String(u._id), u.phone]));
      for (const r of affected) {
        const phone = phoneById.get(String(r.customerId));
        if (phone) {
          void notificationService.reservationCancelled(phone, {
            date: r.date.toISOString().slice(0, 10),
            startTime: r.startTime,
            reason: 'خروج متخصص از سالن',
          });
        }
      }
    })();
  }

  // Remove the membership and the now-orphan working hours for this salon.
  await WorkingHour.deleteMany({ stylistId, salonId });
  await link.deleteOne();

  return { salonId, cancelledReservations: affected.length };
}

/** Toggle whether the stylist currently accepts new reservations. */
export async function setAcceptingReservations(stylistId: string, isAccepting: boolean) {
  const profile = await ensureStylistProfile(stylistId);
  profile.isAcceptingReservations = isAccepting;
  await profile.save();
  return { isAcceptingReservations: profile.isAcceptingReservations };
}

// ───────────────────────── Working hours ─────────────────────────

interface WorkingHourEntry {
  salonId: string | null;
  dayOfWeek: number;
  start: string;
  end: string;
}

/** Assert a single interval is well-formed (HH:mm already enforced by Zod). */
function assertOrdered(entry: { start: string; end: string }) {
  if (!isOrdered({ start: entry.start, end: entry.end })) {
    throw AppError.badRequest(
      `Interval ${entry.start}-${entry.end} is invalid (start must be before end)`,
      'INVALID_INTERVAL',
    );
  }
}

/**
 * Resolve the distinct salonIds and ensure each is a USABLE membership of the
 * stylist (active OR pending — a pending stylist may still work and be booked;
 * only rejected memberships are forbidden).
 * Returns a map salonId -> Salon for downstream opening-hours checks.
 */
async function ensureUsableSalons(
  stylistId: string,
  salonIds: string[],
): Promise<Map<string, ISalon>> {
  if (salonIds.length === 0) return new Map();

  const links = await StylistSalon.find({ stylistId, salonId: { $in: salonIds } });
  const linkBySalon = new Map(links.map((l) => [String(l.salonId), l]));

  for (const id of salonIds) {
    const link = linkBySalon.get(id);
    if (!link) {
      throw AppError.forbidden(
        `You are not linked to salon ${id}`,
        'SALON_NOT_LINKED',
      );
    }
    // Active and pending memberships may define working hours / be booked;
    // only rejected memberships are forbidden.
    if (link.status === 'rejected') {
      throw AppError.badRequest(
        `Your membership in salon ${id} was rejected`,
        'SALON_REJECTED',
      );
    }
  }

  const salons = await Salon.find({ _id: { $in: salonIds } });
  return new Map(salons.map((s) => [String(s._id), s]));
}

/** Persian weekday names indexed by dayOfWeek (0=یکشنبه … 6=شنبه, JS getUTCDay). */
const WEEKDAY_FA = ['یکشنبه', 'دوشنبه', 'سه‌شنبه', 'چهارشنبه', 'پنجشنبه', 'جمعه', 'شنبه'];

/** True when the salon has no opening hours defined on ANY day yet. */
function hasNoOpeningHours(salon: ISalon): boolean {
  return (
    !salon.openingHours ||
    salon.openingHours.length === 0 ||
    salon.openingHours.every((h) => h.intervals.length === 0)
  );
}

/** Assert a salon-bound entry fits entirely inside the salon's opening hours. */
function assertInsideOpeningHours(salon: ISalon, entry: WorkingHourEntry) {
  // The salon's hours haven't been set at all → there is nothing to validate
  // against. Reject explicitly instead of silently accepting any interval.
  if (hasNoOpeningHours(salon)) {
    throw AppError.badRequest(
      'ابتدا باید ساعت کاری سالن مشخص شود؛ سپس می‌توانید بازه‌ی کاری خود را داخل آن ثبت کنید.',
      'SALON_HOURS_NOT_SET',
      { salonId: String(salon._id) },
    );
  }

  const dayHours = salon.openingHours.find((h) => h.dayOfWeek === entry.dayOfWeek);
  const fits =
    dayHours?.intervals.some((iv) =>
      contains({ start: iv.start, end: iv.end }, { start: entry.start, end: entry.end }),
    ) ?? false;

  if (!fits) {
    const dayName = WEEKDAY_FA[entry.dayOfWeek] ?? `روز ${entry.dayOfWeek}`;
    const allowed =
      dayHours && dayHours.intervals.length > 0
        ? dayHours.intervals.map((iv) => `${iv.start} تا ${iv.end}`).join('، ')
        : null;
    const message = allowed
      ? `سالن ${dayName} ${allowed} باز است؛ بازه‌ی ${entry.start}–${entry.end} خارج از این ساعت است.`
      : `سالن ${dayName} تعطیل است؛ نمی‌توان برای این روز بازه‌ی کاری ثبت کرد.`;
    throw AppError.badRequest(message, 'OUTSIDE_OPENING_HOURS', {
      dayOfWeek: entry.dayOfWeek,
      allowedIntervals: dayHours?.intervals ?? [],
    });
  }
}

/**
 * Assert that, per day of week, no two intervals overlap. Adjacent intervals
 * that merely touch (e.g. 09:00-12:00 and 12:00-15:00) are allowed. The check
 * is salon-agnostic: a stylist cannot be in two places at the same instant.
 */
function assertNoOverlaps(entries: { dayOfWeek: number; start: string; end: string }[]) {
  const byDay = new Map<number, Interval[]>();
  for (const e of entries) {
    const list = byDay.get(e.dayOfWeek) ?? [];
    const candidate: Interval = { start: e.start, end: e.end };
    for (const existing of list) {
      if (overlaps(existing, candidate)) {
        throw AppError.conflict(
          `Overlapping working hours on day ${e.dayOfWeek}: ${existing.start}-${existing.end} conflicts with ${candidate.start}-${candidate.end}`,
          'WORKING_HOURS_OVERLAP',
        );
      }
    }
    list.push(candidate);
    byDay.set(e.dayOfWeek, list);
  }
}

/**
 * Validate one entry in isolation: ordering + active salon + opening hours.
 * (Cross-entry overlap is validated separately against the full set.)
 */
async function validateEntry(stylistId: string, entry: WorkingHourEntry) {
  assertOrdered(entry);
  if (entry.salonId) {
    const salonMap = await ensureUsableSalons(stylistId, [entry.salonId]);
    const salon = salonMap.get(entry.salonId);
    if (!salon) throw AppError.notFound('Salon not found', 'SALON_NOT_FOUND');
    assertInsideOpeningHours(salon, entry);
  }
}

/**
 * Step 4 — set the stylist's working hours (full replace, atomic).
 * Every entry is validated before any write; if a single entry is invalid the
 * whole request is rejected and existing hours are left untouched.
 */
export async function setWorkingHours(stylistId: string, entries: WorkingHourEntry[]) {
  // 1) Per-entry ordering.
  for (const e of entries) assertOrdered(e);

  // 2) Salon linkage must be ACTIVE, and intervals inside opening hours.
  const salonIds = [...new Set(entries.map((e) => e.salonId).filter(Boolean))] as string[];
  const salonMap = await ensureUsableSalons(stylistId, salonIds);
  for (const e of entries) {
    if (!e.salonId) continue;
    const salon = salonMap.get(e.salonId);
    if (!salon) throw AppError.notFound('Salon not found', 'SALON_NOT_FOUND');
    assertInsideOpeningHours(salon, e);
  }

  // 3) No overlapping intervals on the same day (even across different salons).
  assertNoOverlaps(entries);

  // 4) All valid → replace atomically (delete + insert).
  await WorkingHour.deleteMany({ stylistId });
  if (entries.length > 0) {
    await WorkingHour.insertMany(
      entries.map((e) => ({
        stylistId: new Types.ObjectId(stylistId),
        salonId: e.salonId ? new Types.ObjectId(e.salonId) : null,
        dayOfWeek: e.dayOfWeek,
        start: e.start,
        end: e.end,
      })),
    );
  }

  const profile = await ensureStylistProfile(stylistId);
  await advanceStep(profile, 'workingHours');

  return getWorkingHours(stylistId);
}

/**
 * Return the stylist's weekly schedule grouped by day of week, with each
 * interval's salon info attached (null for freelance intervals).
 */
export async function getWorkingHours(stylistId: string) {
  const hours = await WorkingHour.find({ stylistId })
    .populate<{ salonId: ISalon | null }>('salonId')
    .sort({ dayOfWeek: 1, start: 1 });

  const days = Array.from({ length: 7 }, (_, dayOfWeek) => ({
    dayOfWeek,
    entries: [] as Array<{
      id: string;
      start: string;
      end: string;
      salon: { id: string; name: string } | null;
    }>,
  }));

  for (const h of hours) {
    const salon = h.salonId as unknown as ISalon | null;
    days[h.dayOfWeek].entries.push({
      id: String(h._id),
      start: h.start,
      end: h.end,
      salon: salon ? { id: String(salon._id), name: salon.name } : null,
    });
  }

  return { schedule: days };
}

interface WorkingHourPatch {
  salonId?: string | null;
  dayOfWeek?: number;
  start?: string;
  end?: string;
}

/** Update a single working-hours interval, re-running all validations. */
export async function updateWorkingHour(
  stylistId: string,
  workingHourId: string,
  patch: WorkingHourPatch,
) {
  const current = await WorkingHour.findOne({ _id: workingHourId, stylistId });
  if (!current) {
    throw AppError.notFound('Working-hours entry not found', 'WORKING_HOUR_NOT_FOUND');
  }

  // Merge patch onto the existing entry.
  const merged: WorkingHourEntry = {
    salonId:
      patch.salonId !== undefined
        ? patch.salonId
        : current.salonId
          ? String(current.salonId)
          : null,
    dayOfWeek: patch.dayOfWeek ?? current.dayOfWeek,
    start: patch.start ?? current.start,
    end: patch.end ?? current.end,
  };

  // Validate the merged entry on its own.
  await validateEntry(stylistId, merged);

  // Overlap check against all OTHER entries of this stylist.
  const others = await WorkingHour.find({ stylistId, _id: { $ne: workingHourId } });
  assertNoOverlaps([
    ...others.map((o) => ({ dayOfWeek: o.dayOfWeek, start: o.start, end: o.end })),
    merged,
  ]);

  current.salonId = merged.salonId ? new Types.ObjectId(merged.salonId) : null;
  current.dayOfWeek = merged.dayOfWeek;
  current.start = merged.start;
  current.end = merged.end;
  await current.save();

  return getWorkingHours(stylistId);
}

/** Delete a single working-hours interval. */
export async function deleteWorkingHour(stylistId: string, workingHourId: string) {
  const result = await WorkingHour.deleteOne({ _id: workingHourId, stylistId });
  if (result.deletedCount === 0) {
    throw AppError.notFound('Working-hours entry not found', 'WORKING_HOUR_NOT_FOUND');
  }
  return getWorkingHours(stylistId);
}

// ───────────────────── Service management (post-onboarding) ─────────────────────

/**
 * List the stylist's current services with their EFFECTIVE price/duration
 * (per-stylist override, falling back to the service default) plus the raw
 * overrides so the edit UI can distinguish "custom" from "default".
 */
export async function listStylistServices(stylistId: string) {
  const links = await StylistService.find({ stylistId })
    .populate<{ serviceId: IService }>('serviceId')
    .sort({ createdAt: 1 });

  const services = links
    .map((link) => {
      const svc = link.serviceId as unknown as IService | null;
      if (!svc) return null;
      return {
        id: String(link._id),
        serviceId: String(svc._id),
        name: svc.name,
        categoryId: String(svc.categoryId),
        price: link.price ?? svc.defaultPrice, // effective
        durationMin: link.durationMin ?? svc.durationMin, // effective
        customPrice: link.price,
        customDurationMin: link.durationMin,
        defaultPrice: svc.defaultPrice,
        defaultDurationMin: svc.durationMin,
        isCustom: !!svc.isCustom,
      };
    })
    .filter(Boolean);

  return { services };
}

/**
 * Full replace of the stylist's service set (post-onboarding management).
 * Same validation as onboarding but does NOT touch onboardingStep.
 */
export async function replaceStylistServices(stylistId: string, items: ServiceItem[]) {
  const serviceIds = items.map((i) => i.serviceId);
  if (serviceIds.length > 0) {
    const found = await Service.find({ _id: { $in: serviceIds } }).select('_id');
    if (found.length !== new Set(serviceIds).size) {
      throw AppError.badRequest('One or more services do not exist', 'SERVICE_NOT_FOUND');
    }
  }

  for (const item of items) {
    await StylistService.updateOne(
      { stylistId, serviceId: item.serviceId },
      { $set: { price: item.price ?? null, durationMin: item.durationMin ?? null } },
      { upsert: true },
    );
  }
  const keep = [...serviceIds, ...(await customServiceIds(stylistId))];
  await StylistService.deleteMany({ stylistId, serviceId: { $nin: keep } });

  return listStylistServices(stylistId);
}

/** Add (or upsert) a single service to the stylist's offering. */
export async function addStylistService(
  stylistId: string,
  serviceId: string,
  data: { price?: number | null; durationMin?: number | null },
) {
  const svc = await Service.findById(serviceId).select('_id');
  if (!svc) throw AppError.notFound('Service not found', 'SERVICE_NOT_FOUND');

  await StylistService.updateOne(
    { stylistId, serviceId },
    { $set: { price: data.price ?? null, durationMin: data.durationMin ?? null } },
    { upsert: true },
  );
  return listStylistServices(stylistId);
}

/** Edit the custom price/duration of one of the stylist's services. */
export async function updateStylistService(
  stylistId: string,
  serviceId: string,
  data: { price?: number | null; durationMin?: number | null },
) {
  const link = await StylistService.findOne({ stylistId, serviceId });
  if (!link) {
    throw AppError.notFound('This service is not in your offering', 'STYLIST_SERVICE_NOT_FOUND');
  }
  if (data.price !== undefined) link.price = data.price;
  if (data.durationMin !== undefined) link.durationMin = data.durationMin;
  await link.save();
  return listStylistServices(stylistId);
}

/** Remove a single service from the stylist's offering. */
export async function removeStylistService(stylistId: string, serviceId: string) {
  const result = await StylistService.deleteOne({ stylistId, serviceId });
  if (result.deletedCount === 0) {
    throw AppError.notFound('This service is not in your offering', 'STYLIST_SERVICE_NOT_FOUND');
  }
  return listStylistServices(stylistId);
}

// ───────────────────── Custom (stylist-private) services ─────────────────────

/** The stylist's custom service ids (as strings), to preserve on a set-replace. */
async function customServiceIds(stylistId: string): Promise<string[]> {
  const ids = await Service.find({ isCustom: true, ownerStylistId: stylistId }).distinct('_id');
  return ids.map((id) => String(id));
}

/** Resolve the category for a custom service (given id, or fall back to first). */
async function resolveCategoryId(categoryId?: string): Promise<Types.ObjectId> {
  if (categoryId) {
    const cat = await ServiceCategory.findById(categoryId).select('_id');
    if (!cat) throw AppError.badRequest('دسته‌بندی نامعتبر است', 'CATEGORY_NOT_FOUND');
    return cat._id as Types.ObjectId;
  }
  const first = await ServiceCategory.findOne().sort({ order: 1, name: 1 }).select('_id');
  if (!first) throw AppError.badRequest('دسته‌بندی‌ای موجود نیست', 'NO_CATEGORY');
  return first._id as Types.ObjectId;
}

/**
 * Create a stylist-private (custom) service and attach it to the stylist. It
 * never appears in the public catalogue or for other stylists.
 */
export async function createCustomService(
  stylistId: string,
  data: { name: string; durationMin: number; price: number; categoryId?: string },
) {
  const categoryId = await resolveCategoryId(data.categoryId);
  const service = await Service.create({
    categoryId,
    name: data.name,
    durationMin: data.durationMin,
    defaultPrice: data.price,
    isDefault: false,
    isCustom: true,
    ownerStylistId: new Types.ObjectId(stylistId),
  });
  // Link to the stylist (price/duration inherit from the custom service).
  await StylistService.create({
    stylistId: new Types.ObjectId(stylistId),
    serviceId: service._id,
    price: null,
    durationMin: null,
  });
  return listStylistServices(stylistId);
}

/** Load a custom service owned by this stylist (or throw). */
async function ownedCustomService(stylistId: string, serviceId: string) {
  if (!Types.ObjectId.isValid(serviceId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const service = await Service.findById(serviceId);
  if (!service || !service.isCustom || String(service.ownerStylistId) !== stylistId) {
    throw AppError.notFound('خدمت اختصاصی یافت نشد', 'CUSTOM_SERVICE_NOT_FOUND');
  }
  return service;
}

export async function updateCustomService(
  stylistId: string,
  serviceId: string,
  data: { name?: string; durationMin?: number; price?: number; categoryId?: string },
) {
  const service = await ownedCustomService(stylistId, serviceId);
  if (data.name !== undefined) service.name = data.name;
  if (data.durationMin !== undefined) service.durationMin = data.durationMin;
  if (data.price !== undefined) service.defaultPrice = data.price;
  if (data.categoryId !== undefined) service.categoryId = await resolveCategoryId(data.categoryId);
  await service.save();
  return listStylistServices(stylistId);
}

export async function deleteCustomService(stylistId: string, serviceId: string) {
  const service = await ownedCustomService(stylistId, serviceId);
  await StylistService.deleteMany({ stylistId, serviceId: service._id });
  await service.deleteOne();
  return listStylistServices(stylistId);
}

// ───────────────────── Verification (blue tick) ─────────────────────

/**
 * Submit the profile for admin verification. Requires the core profile to be
 * complete; otherwise returns a clear list of what's missing. Re-submission is
 * allowed from 'incomplete'/'rejected', but not while 'pending'/'verified'.
 */
export async function submitVerification(stylistId: string) {
  const profile = await ensureStylistProfile(stylistId);
  const user = await User.findById(stylistId)
    .select('firstName lastName nationalCode profilePhoto')
    .lean();

  const missing: string[] = [];
  if (!user?.firstName || !user?.lastName) missing.push('نام و نام خانوادگی');
  if (!user?.nationalCode) missing.push('کد ملی');
  if (!user?.profilePhoto) missing.push('عکس پروفایل');
  if (!(profile.portfolio && profile.portfolio.length > 0)) missing.push('حداقل یک نمونه‌کار');
  if (!profile.nationalCardFront || !profile.nationalCardBack) missing.push('تصاویر روی و پشت کارت ملی');
  if (profile.status !== 'active') missing.push('تکمیل آنبوردینگ');

  if (missing.length > 0) {
    throw AppError.badRequest(
      `برای ارسال جهت تأیید، این موارد باید کامل شود: ${missing.join('، ')}`,
      'PROFILE_INCOMPLETE',
      { missing },
    );
  }
  if (profile.verificationStatus === 'verified') {
    throw AppError.badRequest('پروفایل شما قبلاً تأیید شده است', 'ALREADY_VERIFIED');
  }
  if (profile.verificationStatus === 'pending') {
    throw AppError.badRequest('درخواست تأیید شما در حال بررسی است', 'VERIFICATION_PENDING');
  }

  profile.verificationStatus = 'pending';
  profile.profileSubmittedAt = new Date();
  profile.rejectionReason = null;
  await profile.save();

  return {
    verificationStatus: profile.verificationStatus,
    profileSubmittedAt: profile.profileSubmittedAt,
  };
}

/**
 * Save the (PRIVATE) national-ID card images. Both sides are required. The
 * files are written by a PRIVATE uploader (outside the public mount); only the
 * storage KEYS are kept on the profile — never a public URL.
 */
export async function saveVerificationDocuments(
  stylistId: string,
  files: { nationalCardFront?: Express.Multer.File[]; nationalCardBack?: Express.Multer.File[] },
) {
  const front = files.nationalCardFront?.[0];
  const back = files.nationalCardBack?.[0];
  if (!front || !back) {
    throw AppError.badRequest('هر دو تصویر روی و پشت کارت ملی لازم است', 'DOCUMENTS_REQUIRED');
  }

  const profile = await ensureStylistProfile(stylistId);
  const f = await storageProvider.savePrivate(front);
  const b = await storageProvider.savePrivate(back);
  profile.nationalCardFront = f.path;
  profile.nationalCardBack = b.path;
  profile.documentsSubmittedAt = new Date();
  await profile.save();

  // NOTE: keys are private; the response only confirms presence, no URLs.
  return {
    nationalCardFront: true,
    nationalCardBack: true,
    documentsSubmittedAt: profile.documentsSubmittedAt,
  };
}

/**
 * Resolve a national-ID image for STREAMING behind auth. Caller MUST enforce
 * access (owner or admin) before calling. Returns the absolute path + mime;
 * never build a public URL from this.
 */
export async function resolveVerificationDocument(stylistId: string, side: 'front' | 'back') {
  const profile = await StylistProfile.findOne({ userId: stylistId })
    .select('nationalCardFront nationalCardBack')
    .lean();
  const key = side === 'front' ? profile?.nationalCardFront : profile?.nationalCardBack;
  if (!key) throw AppError.notFound('سند یافت نشد', 'DOCUMENT_NOT_FOUND');

  const absolutePath = storageProvider.getPrivateAbsolutePath(key);
  if (!fs.existsSync(absolutePath)) throw AppError.notFound('فایل یافت نشد', 'FILE_NOT_FOUND');

  const ext = path.extname(key).toLowerCase();
  const contentType =
    ext === '.png' ? 'image/png' : ext === '.webp' ? 'image/webp' : 'image/jpeg';
  return { absolutePath, contentType };
}

/** Read the stylist profile (used by the media step and others). */
export { getStylistProfile };
