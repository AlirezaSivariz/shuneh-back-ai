/**
 * Stylist-owned discount codes: CRUD + validation/preview + booking-time apply.
 *
 * All date/day/time checks use the fixed Iran timezone. Two distinct windows:
 *   - validFrom / validUntil  → when the code can be REDEEMED (checked vs now).
 *   - timeConstraints         → constraints on the APPOINTMENT's day & time.
 *
 * For `appliesTo='services'`, the discount applies ONLY to the eligible
 * services' share of the total (their summed price), not the whole booking.
 */
import { Types } from 'mongoose';
import { DiscountCode, IDiscountCode } from '../../models/DiscountCode';
import { StylistService } from '../../models/StylistService';
import { Service, IService } from '../../models/Service';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { toMinutes } from '../../utils/time';
import { iranWallClockToUtc } from '../../utils/timezone';
import { effectivePrice, effectiveDuration } from '../stylist/public.service';

interface PricedItem {
  serviceId: Types.ObjectId | string;
  price: number;
  durationMin?: number;
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const toDateOrNull = (s?: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);

/** Public DTO for a discount code. */
export function serializeDiscountCode(d: IDiscountCode) {
  return {
    id: String(d._id),
    code: d.code,
    type: d.type,
    value: d.value,
    maxDiscountAmount: d.maxDiscountAmount,
    appliesTo: d.appliesTo,
    serviceIds: d.serviceIds.map((id) => String(id)),
    validFrom: dateOnly(d.validFrom),
    validUntil: dateOnly(d.validUntil),
    timeConstraints: {
      daysOfWeek: d.timeConstraints?.daysOfWeek ?? null,
      startTime: d.timeConstraints?.startTime ?? null,
      endTime: d.timeConstraints?.endTime ?? null,
    },
    usageLimit: d.usageLimit,
    usedCount: d.usedCount,
    isActive: d.isActive,
    createdAt: d.createdAt,
    updatedAt: d.updatedAt,
  };
}

/** Every serviceId must be one the stylist actually offers. */
async function assertOwnsServices(stylistId: string, serviceIds: string[]) {
  const ids = [...new Set(serviceIds.map(String))];
  if (ids.length === 0) return;
  const owned = await StylistService.find({ stylistId, serviceId: { $in: ids } }).distinct(
    'serviceId',
  );
  if (owned.length !== ids.length) {
    throw AppError.badRequest('برخی خدمات انتخابی جزو خدمات شما نیستند', 'SERVICE_NOT_OFFERED');
  }
}

// ───────────────────────────── CRUD ─────────────────────────────

interface DiscountInput {
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  maxDiscountAmount?: number | null;
  appliesTo?: 'all' | 'services';
  serviceIds?: string[];
  validFrom?: string | null;
  validUntil?: string | null;
  timeConstraints?: {
    daysOfWeek?: number[] | null;
    startTime?: string | null;
    endTime?: string | null;
  };
  usageLimit?: number | null;
  isActive?: boolean;
}

export async function createDiscountCode(stylistId: string, data: DiscountInput) {
  const codeLower = data.code.trim().toLowerCase();
  const exists = await DiscountCode.findOne({ stylistId, codeLower }).select('_id').lean();
  if (exists) {
    throw AppError.conflict('کدی با این نام قبلاً ساخته‌اید', 'DISCOUNT_CODE_DUPLICATE');
  }

  const appliesTo = data.appliesTo ?? 'all';
  const serviceIds = appliesTo === 'services' ? data.serviceIds ?? [] : [];
  if (appliesTo === 'services') await assertOwnsServices(stylistId, serviceIds);

  const doc = await DiscountCode.create({
    stylistId: new Types.ObjectId(stylistId),
    code: data.code.trim(),
    codeLower,
    type: data.type,
    value: data.value,
    maxDiscountAmount: data.type === 'percentage' ? data.maxDiscountAmount ?? null : null,
    appliesTo,
    serviceIds: serviceIds.map((id) => new Types.ObjectId(id)),
    validFrom: toDateOrNull(data.validFrom),
    validUntil: toDateOrNull(data.validUntil),
    timeConstraints: {
      daysOfWeek: data.timeConstraints?.daysOfWeek ?? null,
      startTime: data.timeConstraints?.startTime ?? null,
      endTime: data.timeConstraints?.endTime ?? null,
    },
    usageLimit: data.usageLimit ?? null,
    usedCount: 0,
    isActive: data.isActive ?? true,
  });

  return serializeDiscountCode(doc);
}

export async function listDiscountCodes(stylistId: string) {
  const codes = await DiscountCode.find({ stylistId }).sort({ createdAt: -1 });
  return codes.map(serializeDiscountCode);
}

async function ownedCode(stylistId: string, id: string): Promise<IDiscountCode> {
  if (!Types.ObjectId.isValid(id)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const doc = await DiscountCode.findOne({ _id: id, stylistId });
  if (!doc) throw AppError.notFound('کد تخفیف یافت نشد', 'DISCOUNT_CODE_NOT_FOUND');
  return doc;
}

export async function updateDiscountCode(
  stylistId: string,
  id: string,
  patch: Partial<DiscountInput>,
) {
  const doc = await ownedCode(stylistId, id);

  if (patch.code !== undefined) {
    const codeLower = patch.code.trim().toLowerCase();
    if (codeLower !== doc.codeLower) {
      const clash = await DiscountCode.findOne({ stylistId, codeLower, _id: { $ne: doc._id } })
        .select('_id')
        .lean();
      if (clash) throw AppError.conflict('کدی با این نام قبلاً ساخته‌اید', 'DISCOUNT_CODE_DUPLICATE');
    }
    doc.code = patch.code.trim();
    doc.codeLower = codeLower;
  }
  if (patch.type !== undefined) doc.type = patch.type;
  if (patch.value !== undefined) doc.value = patch.value;
  if (patch.maxDiscountAmount !== undefined) doc.maxDiscountAmount = patch.maxDiscountAmount ?? null;

  // appliesTo / serviceIds move together; re-validate ownership.
  const nextAppliesTo = patch.appliesTo ?? doc.appliesTo;
  if (patch.appliesTo !== undefined || patch.serviceIds !== undefined) {
    if (nextAppliesTo === 'services') {
      const ids = patch.serviceIds ?? doc.serviceIds.map((s) => String(s));
      if (ids.length === 0) {
        throw AppError.badRequest('برای خدمات انتخابی حداقل یک خدمت لازم است', 'DISCOUNT_NO_SERVICES');
      }
      await assertOwnsServices(stylistId, ids);
      doc.serviceIds = ids.map((s) => new Types.ObjectId(s));
    } else {
      doc.serviceIds = [];
    }
    doc.appliesTo = nextAppliesTo;
  }

  if (patch.validFrom !== undefined) doc.validFrom = toDateOrNull(patch.validFrom);
  if (patch.validUntil !== undefined) doc.validUntil = toDateOrNull(patch.validUntil);
  if (doc.validFrom && doc.validUntil && doc.validFrom > doc.validUntil) {
    throw AppError.badRequest('تاریخ شروع باید قبل از پایان باشد', 'INVALID_DATE_RANGE');
  }
  if (patch.timeConstraints !== undefined) {
    doc.timeConstraints = {
      daysOfWeek: patch.timeConstraints.daysOfWeek ?? null,
      startTime: patch.timeConstraints.startTime ?? null,
      endTime: patch.timeConstraints.endTime ?? null,
    };
  }
  if (patch.usageLimit !== undefined) doc.usageLimit = patch.usageLimit ?? null;
  if (patch.isActive !== undefined) doc.isActive = patch.isActive;

  await doc.save();
  return serializeDiscountCode(doc);
}

export async function deleteDiscountCode(stylistId: string, id: string) {
  const doc = await ownedCode(stylistId, id);
  await doc.deleteOne();
  return { id };
}

// ─────────────────────── Validation / apply ───────────────────────

/** Resolve effective per-service price/duration for a stylist (throws if not offered). */
export async function resolveItems(
  stylistId: string,
  serviceIds: string[],
): Promise<{ serviceId: Types.ObjectId; price: number; durationMin: number }[]> {
  const stylistServices = await StylistService.find({
    stylistId,
    serviceId: { $in: serviceIds },
  }).lean();
  if (stylistServices.length !== new Set(serviceIds).size) {
    throw AppError.badRequest('یک یا چند سرویس برای این متخصص موجود نیست', 'SERVICE_NOT_OFFERED');
  }
  const services = await Service.find({ _id: { $in: serviceIds } }).lean();
  const svcById = new Map(services.map((s) => [String(s._id), s as unknown as IService]));
  return stylistServices.map((ss) => {
    const svc = svcById.get(String(ss.serviceId))!;
    return {
      serviceId: ss.serviceId as Types.ObjectId,
      price: effectivePrice(ss.price, svc),
      durationMin: effectiveDuration(ss.durationMin, svc),
    };
  });
}

/** Find the stylist's code by name (case-insensitive); throws if missing. */
async function findCode(stylistId: string, code: string): Promise<IDiscountCode> {
  const codeLower = code.trim().toLowerCase();
  const doc = await DiscountCode.findOne({ stylistId, codeLower });
  if (!doc) throw AppError.badRequest('کد تخفیف نامعتبر است', 'INVALID_DISCOUNT_CODE');
  return doc;
}

/** Assert the code may be redeemed right now (active + within its date window). */
function assertRedeemable(code: IDiscountCode) {
  if (!code.isActive) throw AppError.badRequest('این کد تخفیف غیرفعال است', 'DISCOUNT_INACTIVE');
  const now = Date.now();
  if (code.validFrom && iranWallClockToUtc(code.validFrom, '00:00').getTime() > now) {
    throw AppError.badRequest('این کد تخفیف هنوز فعال نشده است', 'DISCOUNT_NOT_STARTED');
  }
  if (code.validUntil && iranWallClockToUtc(code.validUntil, '23:59').getTime() < now) {
    throw AppError.badRequest('این کد تخفیف منقضی شده است', 'DISCOUNT_EXPIRED');
  }
  if (code.usageLimit != null && code.usedCount >= code.usageLimit) {
    throw AppError.badRequest('ظرفیت استفاده از این کد تکمیل شده است', 'DISCOUNT_LIMIT_REACHED');
  }
}

/**
 * Validate the appointment day/time + eligible services and compute the amounts.
 * Pure (no DB writes). Throws an AppError with a clear Persian reason if invalid.
 */
function computeDiscount(
  code: IDiscountCode,
  items: PricedItem[],
  date: string,
  startTime: string,
) {
  const dayDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dayDate.getTime())) {
    throw AppError.badRequest('تاریخ نامعتبر است', 'INVALID_DATE');
  }
  const dayOfWeek = dayDate.getUTCDay(); // Iran weekday (0=Sun … 6=Sat)

  const tc = code.timeConstraints;
  if (tc?.daysOfWeek && tc.daysOfWeek.length > 0 && !tc.daysOfWeek.includes(dayOfWeek)) {
    throw AppError.badRequest(
      'این کد برای روز انتخابی نوبت معتبر نیست',
      'DISCOUNT_DAY_NOT_ALLOWED',
    );
  }
  if (tc?.startTime && tc?.endTime) {
    const t = toMinutes(startTime);
    if (t < toMinutes(tc.startTime) || t > toMinutes(tc.endTime)) {
      throw AppError.badRequest(
        `این کد فقط برای نوبت‌های بین ${tc.startTime} تا ${tc.endTime} معتبر است`,
        'DISCOUNT_TIME_NOT_ALLOWED',
      );
    }
  }

  const originalPrice = items.reduce((s, i) => s + i.price, 0);

  let eligibleServiceIds: string[];
  if (code.appliesTo === 'services') {
    const allowed = new Set(code.serviceIds.map((id) => String(id)));
    eligibleServiceIds = items
      .filter((i) => allowed.has(String(i.serviceId)))
      .map((i) => String(i.serviceId));
    if (eligibleServiceIds.length === 0) {
      throw AppError.badRequest(
        'این کد روی خدمات انتخابی شما اعمال نمی‌شود',
        'DISCOUNT_NOT_APPLICABLE',
      );
    }
  } else {
    eligibleServiceIds = items.map((i) => String(i.serviceId));
  }

  // Discount applies only to the eligible services' share of the total.
  const eligibleAmount = items
    .filter((i) => eligibleServiceIds.includes(String(i.serviceId)))
    .reduce((s, i) => s + i.price, 0);

  let discountAmount: number;
  if (code.type === 'percentage') {
    discountAmount = (eligibleAmount * code.value) / 100;
    if (code.maxDiscountAmount != null) {
      discountAmount = Math.min(discountAmount, code.maxDiscountAmount);
    }
  } else {
    discountAmount = Math.min(code.value, eligibleAmount);
  }
  discountAmount = Math.round(discountAmount);
  const finalPrice = Math.max(0, originalPrice - discountAmount);

  return { originalPrice, discountAmount, finalPrice, eligibleServiceIds };
}

/**
 * The FULL, customer-facing terms of a code (for transparency / trust). Resolves
 * the owning stylist's name and the eligible service names. Dates are returned
 * Gregorian YYYY-MM-DD (the client renders Jalali).
 */
async function buildConditions(code: IDiscountCode, stylistId: string) {
  const [user, serviceDocs] = await Promise.all([
    User.findById(stylistId).select('firstName lastName').lean(),
    code.appliesTo === 'services' && code.serviceIds.length
      ? Service.find({ _id: { $in: code.serviceIds } })
          .select('name')
          .lean()
      : Promise.resolve([] as { _id: Types.ObjectId; name: string }[]),
  ]);
  const stylistName = `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || 'متخصص';
  return {
    code: code.code,
    stylistId,
    stylistName,
    type: code.type,
    value: code.value,
    maxDiscountAmount: code.maxDiscountAmount ?? null,
    appliesTo: code.appliesTo,
    services: serviceDocs.map((s) => ({ id: String(s._id), name: s.name })),
    validFrom: dateOnly(code.validFrom),
    validUntil: dateOnly(code.validUntil),
    timeConstraints: {
      daysOfWeek: code.timeConstraints?.daysOfWeek ?? null,
      startTime: code.timeConstraints?.startTime ?? null,
      endTime: code.timeConstraints?.endTime ?? null,
    },
    usageLimit: code.usageLimit ?? null,
    usedCount: code.usedCount ?? 0,
    isActive: code.isActive,
  };
}

/**
 * Preview a code for the customer (no writes). ALWAYS returns the code's full
 * terms (`conditions`) so the customer can see exactly what the code is — plus a
 * structured `valid` + `reason {code,message}` instead of throwing, so the UI can
 * explain WHY a code can't be used right now (wrong day/time/service/expired),
 * not just "invalid". Booking-time enforcement stays strict (resolveDiscountForBooking).
 */
export async function previewDiscount(
  stylistId: string,
  input: { code: string; serviceIds: string[]; date: string; startTime: string },
) {
  const items = await resolveItems(stylistId, input.serviceIds);
  const codeLower = input.code.trim().toLowerCase();
  const code = await DiscountCode.findOne({ stylistId, codeLower });
  if (!code) {
    return {
      valid: false as const,
      reason: { code: 'INVALID_DISCOUNT_CODE', message: 'کد تخفیف نامعتبر است' },
      conditions: null,
    };
  }

  const conditions = await buildConditions(code, stylistId);
  try {
    assertRedeemable(code);
    const { originalPrice, discountAmount, finalPrice, eligibleServiceIds } = computeDiscount(
      code,
      items,
      input.date,
      input.startTime,
    );
    return {
      valid: true as const,
      code: code.code,
      type: code.type,
      value: code.value,
      appliesTo: code.appliesTo,
      eligibleServiceIds,
      originalPrice,
      discountAmount,
      finalPrice,
      conditions,
    };
  } catch (e) {
    // Soft validation failure → return the reason + full terms (don't throw), so
    // the customer sees what's needed. Hard errors (non-AppError) still bubble up.
    if (e instanceof AppError) {
      return { valid: false as const, reason: { code: e.code, message: e.message }, conditions };
    }
    throw e;
  }
}

/**
 * Resolve a discount at booking time against ALREADY-priced items (the same
 * items the reservation will store). Returns the code doc + snapshot amounts.
 * Does NOT consume usage — call `consumeDiscount` atomically after the
 * reservation is created.
 */
export async function resolveDiscountForBooking(
  stylistId: string,
  codeStr: string,
  items: PricedItem[],
  date: string,
  startTime: string,
) {
  const code = await findCode(stylistId, codeStr);
  assertRedeemable(code);
  const amounts = computeDiscount(code, items, date, startTime);
  return { code, ...amounts };
}

/**
 * Atomically increment usedCount, guarding the usage limit so concurrent
 * bookings can't exceed it. Throws if the limit was reached in the meantime.
 */
export async function consumeDiscount(codeId: Types.ObjectId) {
  const updated = await DiscountCode.findOneAndUpdate(
    {
      _id: codeId,
      isActive: true,
      $or: [{ usageLimit: null }, { $expr: { $lt: ['$usedCount', '$usageLimit'] } }],
    },
    { $inc: { usedCount: 1 } },
    { new: true },
  );
  if (!updated) {
    throw AppError.badRequest('ظرفیت استفاده از این کد تکمیل شده است', 'DISCOUNT_LIMIT_REACHED');
  }
  return updated;
}
