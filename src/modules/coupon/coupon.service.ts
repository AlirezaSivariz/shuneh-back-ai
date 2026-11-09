/**
 * Platform-funded coupon management (admin CRUD + stats) and customer
 * validation/redemption.
 *
 * Financial rules:
 *  - The coupon is applied AFTER any stylist-owned discount.
 *  - The online deposit is computed on the price BEFORE the platform coupon, so
 *    specialist deposit shares, refunds and settlements stay untouched.
 *  - The coupon discount is capped so the final payable never drops below the
 *    pre-coupon deposit; Shuneh funds 100% of the discount.
 */
import { Types } from 'mongoose';
import {
  Coupon,
  ICoupon,
  CouponCampaignType,
  COUPON_CAMPAIGN_TYPES,
} from '../../models/Coupon';
import { CouponRedemption } from '../../models/CouponRedemption';
import { CouponCustomerUsage } from '../../models/CouponCustomerUsage';
import { Reservation } from '../../models/Reservation';
import { Service } from '../../models/Service';
import { ServiceCategory } from '../../models/ServiceCategory';
import { StylistProfile } from '../../models/StylistProfile';
import { AuditLog } from '../../models/AuditLog';
import { AppError } from '../../utils/AppError';
import { calculateDeposit } from '../finance/finance.service';

interface PricedItem {
  serviceId: Types.ObjectId | string;
  price: number;
}

interface CouponInput {
  code?: string;
  name?: string | null;
  description?: string | null;
  campaign?: CouponCampaignType;
  type?: 'percentage' | 'fixed';
  value?: number;
  maxDiscountAmount?: number | null;
  minBookingAmount?: number;
  validFrom?: string | null;
  validUntil?: string | null;
  usageLimit?: number | null;
  perCustomerLimit?: number | null;
  newCustomersOnly?: boolean;
  categoryIds?: string[];
  stylistIds?: string[];
  isActive?: boolean;
}

const dateOnly = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : null);
const startOfDay = (s?: string | null) => (s ? new Date(`${s}T00:00:00.000Z`) : null);
const endOfDay = (s?: string | null) => (s ? new Date(`${s}T23:59:59.999Z`) : null);

/** Append an immutable audit record. Never throws into the caller. */
async function audit(
  adminId: string,
  action: string,
  targetId: string,
  summary?: Record<string, unknown>,
) {
  try {
    await AuditLog.create({
      adminId: new Types.ObjectId(adminId),
      action,
      targetType: 'coupon',
      targetId,
      summary: summary ?? null,
    });
  } catch {
    /* auditing must not break the action */
  }
}

interface CouponStats {
  redemptions: number;
  uniqueCustomers: number;
  totalDiscount: number;
  totalFunding: number;
}

const EMPTY_STATS: CouponStats = {
  redemptions: 0,
  uniqueCustomers: 0,
  totalDiscount: 0,
  totalFunding: 0,
};

/** Admin DTO. */
export function serializeCoupon(c: ICoupon, stats: CouponStats = EMPTY_STATS) {
  return {
    id: String(c._id),
    code: c.code,
    name: c.name ?? null,
    description: c.description ?? null,
    campaign: c.campaign,
    type: c.type,
    value: c.value,
    maxDiscountAmount: c.maxDiscountAmount ?? null,
    minBookingAmount: c.minBookingAmount ?? 0,
    validFrom: dateOnly(c.validFrom),
    validUntil: dateOnly(c.validUntil),
    usageLimit: c.usageLimit ?? null,
    perCustomerLimit: c.perCustomerLimit ?? null,
    newCustomersOnly: c.newCustomersOnly ?? false,
    categoryIds: (c.categoryIds ?? []).map(String),
    stylistIds: (c.stylistIds ?? []).map(String),
    usageCount: c.usageCount ?? 0,
    isActive: c.isActive,
    createdBy: c.createdBy ? String(c.createdBy) : null,
    createdAt: c.createdAt,
    updatedAt: c.updatedAt,
    stats,
  };
}

function validateInput(data: CouponInput) {
  if (data.type === 'percentage' && data.value != null) {
    if (data.value < 1 || data.value > 100) {
      throw AppError.badRequest('درصد تخفیف باید بین ۱ تا ۱۰۰ باشد', 'INVALID_COUPON_VALUE');
    }
  }
  if (data.type === 'fixed' && data.value != null && data.value <= 0) {
    throw AppError.badRequest('مبلغ تخفیف باید بزرگ‌تر از صفر باشد', 'INVALID_COUPON_VALUE');
  }
  if (
    data.maxDiscountAmount != null &&
    data.maxDiscountAmount < 0
  ) {
    throw AppError.badRequest('سقف تخفیف نامعتبر است', 'INVALID_COUPON_VALUE');
  }
  if (data.minBookingAmount != null && data.minBookingAmount < 0) {
    throw AppError.badRequest('حداقل مبلغ رزرو نامعتبر است', 'INVALID_COUPON_VALUE');
  }
  if (data.validFrom && data.validUntil && data.validFrom > data.validUntil) {
    throw AppError.badRequest('تاریخ شروع باید قبل از تاریخ پایان باشد', 'INVALID_DATE_RANGE');
  }
}

async function assertReferences(categoryIds: string[], stylistIds: string[]) {
  if (categoryIds.length > 0) {
    const found = await ServiceCategory.countDocuments({ _id: { $in: categoryIds } });
    if (found !== categoryIds.length) {
      throw AppError.badRequest('برخی دسته‌بندی‌های انتخابی یافت نشدند', 'COUPON_CATEGORY_NOT_FOUND');
    }
  }
  if (stylistIds.length > 0) {
    const found = await StylistProfile.countDocuments({ userId: { $in: stylistIds } });
    if (found !== stylistIds.length) {
      throw AppError.badRequest('برخی متخصصان انتخابی یافت نشدند', 'COUPON_STYLIST_NOT_FOUND');
    }
  }
}

// ───────────────────────────── Admin CRUD ─────────────────────────────

export async function createCoupon(adminId: string, data: CouponInput) {
  validateInput(data);
  const code = data.code!.trim();
  const codeLower = code.toLowerCase();
  const exists = await Coupon.findOne({ codeLower }).select('_id').lean();
  if (exists) throw AppError.conflict('کدی با این نام قبلاً ساخته شده است', 'COUPON_DUPLICATE');

  const categoryIds = [...new Set((data.categoryIds ?? []).map(String))];
  const stylistIds = [...new Set((data.stylistIds ?? []).map(String))];
  await assertReferences(categoryIds, stylistIds);

  let doc: ICoupon;
  try {
    doc = await Coupon.create({
      code,
      codeLower,
      name: data.name?.trim() || null,
      description: data.description?.trim() || null,
      campaign: data.campaign ?? 'custom',
      type: data.type,
      value: data.value,
      maxDiscountAmount: data.maxDiscountAmount ?? null,
      minBookingAmount: data.minBookingAmount ?? 0,
      validFrom: startOfDay(data.validFrom),
      validUntil: endOfDay(data.validUntil),
      usageLimit: data.usageLimit ?? null,
      perCustomerLimit: data.perCustomerLimit ?? null,
      newCustomersOnly: data.newCustomersOnly ?? false,
      categoryIds: categoryIds.map((id) => new Types.ObjectId(id)),
      stylistIds: stylistIds.map((id) => new Types.ObjectId(id)),
      usageCount: 0,
      isActive: data.isActive ?? true,
      createdBy: new Types.ObjectId(adminId),
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw AppError.conflict('کدی با این نام قبلاً ساخته شده است', 'COUPON_DUPLICATE');
    }
    throw err;
  }

  await audit(adminId, 'coupon.create', String(doc._id), {
    code: doc.code,
    campaign: doc.campaign,
    type: doc.type,
    value: doc.value,
  });
  return serializeCoupon(doc);
}

export async function listCoupons(filter: {
  search?: string;
  campaign?: CouponCampaignType;
  isActive?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, Number(filter.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(filter.limit) || 20));
  const skip = (page - 1) * limit;

  const q: Record<string, unknown> = {};
  if (filter.campaign) q.campaign = filter.campaign;
  if (filter.isActive !== undefined) q.isActive = filter.isActive;
  if (filter.search) {
    const safe = filter.search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    q.$or = [
      { code: { $regex: safe, $options: 'i' } },
      { name: { $regex: safe, $options: 'i' } },
    ];
  }

  const [rows, total] = await Promise.all([
    Coupon.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Coupon.countDocuments(q),
  ]);

  const ids = rows.map((r) => r._id);
  const statsRows = ids.length
    ? await CouponRedemption.aggregate([
        { $match: { couponId: { $in: ids } } },
        {
          $group: {
            _id: '$couponId',
            redemptions: { $sum: 1 },
            customers: { $addToSet: '$customerId' },
            totalDiscount: { $sum: '$discountAmount' },
            totalFunding: { $sum: '$platformFundedAmount' },
          },
        },
      ])
    : [];
  const statsById = new Map(
    statsRows.map((s) => [
      String(s._id),
      {
        redemptions: s.redemptions ?? 0,
        uniqueCustomers: Array.isArray(s.customers) ? s.customers.length : 0,
        totalDiscount: s.totalDiscount ?? 0,
        totalFunding: s.totalFunding ?? 0,
      } as CouponStats,
    ]),
  );

  const [summaryRaw] = await CouponRedemption.aggregate([
    {
      $group: {
        _id: null,
        totalRedemptions: { $sum: 1 },
        customers: { $addToSet: '$customerId' },
        totalDiscount: { $sum: '$discountAmount' },
        totalFunding: { $sum: '$platformFundedAmount' },
      },
    },
  ]);

  const summary = {
    totalCoupons: await Coupon.countDocuments(),
    activeCoupons: await Coupon.countDocuments({ isActive: true }),
    totalRedemptions: summaryRaw?.totalRedemptions ?? 0,
    uniqueCustomers: Array.isArray(summaryRaw?.customers) ? summaryRaw.customers.length : 0,
    totalDiscount: summaryRaw?.totalDiscount ?? 0,
    totalFunding: summaryRaw?.totalFunding ?? 0,
  };

  return {
    items: rows.map((r) => serializeCoupon(r, statsById.get(String(r._id)) ?? EMPTY_STATS)),
    summary,
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit),
  };
}

async function findCoupon(id: string): Promise<ICoupon> {
  if (!Types.ObjectId.isValid(id)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const doc = await Coupon.findById(id);
  if (!doc) throw AppError.notFound('کد تخفیف یافت نشد', 'COUPON_NOT_FOUND');
  return doc;
}

export async function updateCoupon(adminId: string, id: string, patch: CouponInput) {
  const doc = await findCoupon(id);

  const merged: CouponInput = {
    type: patch.type ?? doc.type,
    value: patch.value ?? doc.value,
    maxDiscountAmount:
      patch.maxDiscountAmount !== undefined ? patch.maxDiscountAmount : doc.maxDiscountAmount,
    minBookingAmount:
      patch.minBookingAmount !== undefined ? patch.minBookingAmount : doc.minBookingAmount,
    validFrom: patch.validFrom !== undefined ? patch.validFrom : dateOnly(doc.validFrom),
    validUntil: patch.validUntil !== undefined ? patch.validUntil : dateOnly(doc.validUntil),
    campaign: patch.campaign ?? doc.campaign,
  };
  validateInput(merged);

  if (patch.code !== undefined) {
    const codeLower = patch.code.trim().toLowerCase();
    if (codeLower !== doc.codeLower) {
      const clash = await Coupon.findOne({ codeLower, _id: { $ne: doc._id } })
        .select('_id')
        .lean();
      if (clash) throw AppError.conflict('کدی با این نام قبلاً ساخته شده است', 'COUPON_DUPLICATE');
    }
    doc.code = patch.code.trim();
    doc.codeLower = codeLower;
  }
  if (patch.name !== undefined) doc.name = patch.name?.trim() || null;
  if (patch.description !== undefined) doc.description = patch.description?.trim() || null;
  if (patch.campaign !== undefined) doc.campaign = patch.campaign;
  if (patch.type !== undefined) doc.type = patch.type;
  if (patch.value !== undefined) doc.value = patch.value;
  if (patch.maxDiscountAmount !== undefined) {
    doc.maxDiscountAmount = patch.maxDiscountAmount ?? null;
  }
  if (patch.minBookingAmount !== undefined) {
    doc.minBookingAmount = patch.minBookingAmount ?? 0;
  }
  if (patch.validFrom !== undefined) doc.validFrom = startOfDay(patch.validFrom);
  if (patch.validUntil !== undefined) doc.validUntil = endOfDay(patch.validUntil);
  if (patch.usageLimit !== undefined) doc.usageLimit = patch.usageLimit ?? null;
  if (patch.perCustomerLimit !== undefined) {
    doc.perCustomerLimit = patch.perCustomerLimit ?? null;
  }
  if (patch.newCustomersOnly !== undefined) doc.newCustomersOnly = patch.newCustomersOnly;
  if (patch.isActive !== undefined) doc.isActive = patch.isActive;

  if (patch.categoryIds !== undefined) {
    const ids = [...new Set(patch.categoryIds.map(String))];
    await assertReferences(ids, []);
    doc.categoryIds = ids.map((s) => new Types.ObjectId(s));
  }
  if (patch.stylistIds !== undefined) {
    const ids = [...new Set(patch.stylistIds.map(String))];
    await assertReferences([], ids);
    doc.stylistIds = ids.map((s) => new Types.ObjectId(s));
  }

  try {
    await doc.save();
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      throw AppError.conflict('کدی با این نام قبلاً ساخته شده است', 'COUPON_DUPLICATE');
    }
    throw err;
  }

  await audit(adminId, 'coupon.update', String(doc._id), {
    code: doc.code,
    campaign: doc.campaign,
    type: doc.type,
    value: doc.value,
    isActive: doc.isActive,
  });
  return serializeCoupon(doc);
}

export async function setCouponStatus(adminId: string, id: string, isActive: boolean) {
  const doc = await findCoupon(id);
  doc.isActive = isActive;
  await doc.save();
  await audit(adminId, 'coupon.setStatus', String(doc._id), { code: doc.code, isActive });
  return serializeCoupon(doc);
}

export async function deleteCoupon(adminId: string, id: string) {
  const doc = await findCoupon(id);
  await doc.deleteOne();
  // Per-customer counters are disposable; immutable redemption records stay for
  // campaign accounting after the coupon itself is gone.
  await CouponCustomerUsage.deleteMany({ couponId: doc._id });
  await audit(adminId, 'coupon.delete', String(doc._id), { code: doc.code });
  return { id: String(doc._id) };
}

// ─────────────────────── Customer eligibility/preview ───────────────────────

/** Assert the coupon may be redeemed right now (active + within its window). */
function assertRedeemable(c: ICoupon) {
  if (!c.isActive) {
    throw AppError.badRequest('این کد تخفیف غیرفعال است', 'COUPON_INACTIVE');
  }
  const now = Date.now();
  if (c.validFrom && c.validFrom.getTime() > now) {
    throw AppError.badRequest('این کد تخفیف هنوز فعال نشده است', 'COUPON_NOT_STARTED');
  }
  if (c.validUntil && c.validUntil.getTime() < now) {
    throw AppError.badRequest('این کد تخفیف منقضی شده است', 'COUPON_EXPIRED');
  }
  if (c.usageLimit != null && (c.usageCount ?? 0) >= c.usageLimit) {
    throw AppError.badRequest('ظرفیت استفاده از این کد تکمیل شده است', 'COUPON_LIMIT_REACHED');
  }
}

/** Reject the coupon when the customer isn't a new customer. */
async function assertNewCustomer(c: ICoupon, customerId: string) {
  if (!c.newCustomersOnly) return;
  const previous = await Reservation.countDocuments({
    customerId: new Types.ObjectId(customerId),
    status: { $ne: 'cancelled' },
    paymentStatus: { $ne: 'awaiting' },
  });
  if (previous > 0) {
    throw AppError.badRequest(
      'این کد تخفیف فقط برای مشتریان جدید است',
      'COUPON_NEW_CUSTOMERS_ONLY',
    );
  }
}

async function assertPerCustomerLimit(c: ICoupon, customerId: string) {
  if (c.perCustomerLimit == null) return;
  const usage = await CouponCustomerUsage.findOne({
    couponId: c._id,
    customerId: new Types.ObjectId(customerId),
  })
    .select('usedCount')
    .lean();
  if ((usage?.usedCount ?? 0) >= c.perCustomerLimit) {
    throw AppError.badRequest(
      'سقف استفاده از این کد برای شما تکمیل شده است',
      'COUPON_PER_CUSTOMER_LIMIT',
    );
  }
}

/**
 * Compute the eligible service share of the booking. Category-restricted
 * coupons only discount the portion of the price attributable to the allowed
 * categories; companions multiply both the gross and eligible shares.
 */
async function eligibleShare(c: ICoupon, items: PricedItem[], persons: number) {
  const baseTotal = items.reduce((s, i) => s + i.price, 0);
  const gross = baseTotal * persons;
  if (c.categoryIds.length === 0) return { gross, eligibleGross: gross };

  const allowed = new Set(c.categoryIds.map(String));
  const services = await Service.find({ _id: { $in: items.map((i) => i.serviceId) } })
    .select('categoryId')
    .lean();
  const categoryByService = new Map(
    services.map((s) => [String(s._id), String(s.categoryId)]),
  );

  const eligibleBase = items
    .filter((i) => allowed.has(categoryByService.get(String(i.serviceId)) ?? ''))
    .reduce((s, i) => s + i.price, 0);

  return { gross, eligibleGross: eligibleBase * persons };
}

interface ResolveArgs {
  code: string;
  customerId: string;
  stylistId: string;
  items: PricedItem[];
  persons: number;
  /** Price after any stylist discount; the coupon base. */
  priceBeforeCoupon: number;
}

/**
 * Resolve a coupon for a concrete booking: eligibility checks + amount math.
 * Pure (no writes). Throws an AppError with a clear Persian reason if invalid.
 */
export async function resolveCouponForBooking(args: ResolveArgs) {
  const codeLower = args.code.trim().toLowerCase();
  const coupon = await Coupon.findOne({ codeLower });
  if (!coupon) throw AppError.badRequest('کد تخفیف نامعتبر است', 'COUPON_NOT_FOUND');

  assertRedeemable(coupon);

  if (coupon.stylistIds.length > 0 && !coupon.stylistIds.map(String).includes(args.stylistId)) {
    throw AppError.badRequest(
      'این کد تخفیف برای متخصص انتخابی معتبر نیست',
      'COUPON_NOT_APPLICABLE',
    );
  }

  const { gross, eligibleGross } = await eligibleShare(coupon, args.items, args.persons);
  if (eligibleGross <= 0) {
    throw AppError.badRequest(
      'این کد تخفیف روی خدمات انتخابی شما اعمال نمی‌شود',
      'COUPON_NOT_APPLICABLE',
    );
  }

  if (args.priceBeforeCoupon < (coupon.minBookingAmount ?? 0)) {
    throw AppError.badRequest(
      `حداقل مبلغ رزرو برای استفاده از این کد ${coupon.minBookingAmount.toLocaleString('fa')} تومان است`,
      'COUPON_MIN_BOOKING',
    );
  }

  await assertNewCustomer(coupon, args.customerId);
  await assertPerCustomerLimit(coupon, args.customerId);

  // Category restriction → only that share of the (post-stylist) price is
  // eligible. For unrestricted coupons the whole price is eligible.
  const eligibleAmount =
    gross > 0 ? Math.round(args.priceBeforeCoupon * (eligibleGross / gross)) : 0;

  let discount =
    coupon.type === 'percentage'
      ? (eligibleAmount * coupon.value) / 100
      : Math.min(coupon.value, eligibleAmount);
  if (coupon.type === 'percentage' && coupon.maxDiscountAmount != null) {
    discount = Math.min(discount, coupon.maxDiscountAmount);
  }
  discount = Math.round(discount);

  // The online deposit is computed on the pre-coupon price. Never discount below
  // it, otherwise the deposit/refund/settlement math would break.
  const depositBreakdown = calculateDeposit(args.priceBeforeCoupon);
  const maxDiscount = Math.max(0, args.priceBeforeCoupon - depositBreakdown.depositAmount);
  discount = Math.min(discount, maxDiscount);

  if (discount <= 0) {
    throw AppError.badRequest(
      'مبلغ این رزرو برای اعمال کد تخفیف کافی نیست',
      'COUPON_NO_DISCOUNT',
    );
  }

  const finalPrice = Math.max(0, args.priceBeforeCoupon - discount);
  const payableOnSite = Math.max(0, finalPrice - depositBreakdown.depositAmount);

  return {
    coupon,
    originalPrice: gross,
    priceBeforeCoupon: args.priceBeforeCoupon,
    discountAmount: discount,
    finalPrice,
    depositAmount: depositBreakdown.depositAmount,
    bookingFee: depositBreakdown.bookingFee,
    payableOnSite,
    platformFundedAmount: discount,
  };
}

/** Public terms shown to the customer before booking. */
function buildConditions(c: ICoupon) {
  return {
    code: c.code,
    name: c.name ?? null,
    description: c.description ?? null,
    campaign: c.campaign,
    type: c.type,
    value: c.value,
    maxDiscountAmount: c.maxDiscountAmount ?? null,
    minBookingAmount: c.minBookingAmount ?? 0,
    validFrom: dateOnly(c.validFrom),
    validUntil: dateOnly(c.validUntil),
    usageLimit: c.usageLimit ?? null,
    perCustomerLimit: c.perCustomerLimit ?? null,
    newCustomersOnly: c.newCustomersOnly ?? false,
    categoryIds: (c.categoryIds ?? []).map(String),
    stylistIds: (c.stylistIds ?? []).map(String),
  };
}

/**
 * Preview a platform coupon for the customer (no writes). Always returns the
 * coupon terms plus a structured `valid`/`reason` instead of throwing, so the
 * UI can explain why a code can't be used.
 */
export async function previewCoupon(
  customerId: string,
  input: {
    code: string;
    stylistId: string;
    items: PricedItem[];
    persons: number;
    priceBeforeCoupon: number;
  },
) {
  const codeLower = input.code.trim().toLowerCase();
  const coupon = await Coupon.findOne({ codeLower });
  if (!coupon) {
    return {
      valid: false as const,
      reason: { code: 'COUPON_NOT_FOUND', message: 'کد تخفیف نامعتبر است' },
      conditions: null,
    };
  }

  const conditions = buildConditions(coupon);
  try {
    const resolved = await resolveCouponForBooking({
      code: input.code,
      customerId,
      stylistId: input.stylistId,
      items: input.items,
      persons: input.persons,
      priceBeforeCoupon: input.priceBeforeCoupon,
    });
    return {
      valid: true as const,
      code: resolved.coupon.code,
      name: resolved.coupon.name ?? null,
      campaign: resolved.coupon.campaign,
      type: resolved.coupon.type,
      value: resolved.coupon.value,
      originalPrice: resolved.originalPrice,
      priceBeforeCoupon: resolved.priceBeforeCoupon,
      discountAmount: resolved.discountAmount,
      finalPrice: resolved.finalPrice,
      depositAmount: resolved.depositAmount,
      bookingFee: resolved.bookingFee,
      payableOnSite: resolved.payableOnSite,
      platformFundedAmount: resolved.platformFundedAmount,
      conditions,
    };
  } catch (e) {
    if (e instanceof AppError) {
      return { valid: false as const, reason: { code: e.code, message: e.message }, conditions };
    }
    throw e;
  }
}

// ─────────────────────── Atomic consumption / rollback ───────────────────────

interface ConsumeArgs {
  coupon: ICoupon;
  customerId: string;
  stylistId: string;
  reservationId: Types.ObjectId;
  originalPrice: number;
  priceBeforeCoupon: number;
  discountAmount: number;
  finalPrice: number;
  depositAmount: number;
}

/**
 * Atomically redeem a coupon for a freshly-created reservation: global counter,
 * per-customer counter, then the immutable redemption record. On any failure the
 * already-incremented counters are restored and the error bubbles up.
 */
export async function consumeCoupon(args: ConsumeArgs): Promise<Types.ObjectId> {
  const couponOid = args.coupon._id;
  const customerOid = new Types.ObjectId(args.customerId);

  const updated = await Coupon.findOneAndUpdate(
    {
      _id: couponOid,
      isActive: true,
      $or: [{ usageLimit: null }, { $expr: { $lt: ['$usageCount', '$usageLimit'] } }],
    },
    { $inc: { usageCount: 1 } },
    { new: true },
  );
  if (!updated) {
    throw AppError.badRequest('ظرفیت استفاده از این کد تکمیل شده است', 'COUPON_LIMIT_REACHED');
  }

  // Ensure the per-customer counter row exists before the guarded increment.
  await CouponCustomerUsage.updateOne(
    { couponId: couponOid, customerId: customerOid },
    { $setOnInsert: { usedCount: 0 } },
    { upsert: true },
  );
  const usage = await CouponCustomerUsage.findOneAndUpdate(
    {
      couponId: couponOid,
      customerId: customerOid,
      ...(updated.perCustomerLimit != null
        ? { usedCount: { $lt: updated.perCustomerLimit } }
        : {}),
    },
    { $inc: { usedCount: 1 } },
    { new: true },
  );

  if (!usage) {
    await Coupon.updateOne(
      { _id: couponOid, usageCount: { $gt: 0 } },
      { $inc: { usageCount: -1 } },
    ).catch(() => undefined);
    throw AppError.badRequest(
      'سقف استفاده از این کد برای شما تکمیل شده است',
      'COUPON_PER_CUSTOMER_LIMIT',
    );
  }

  try {
    const redemption = await CouponRedemption.create({
      couponId: couponOid,
      code: updated.code,
      name: updated.name ?? null,
      campaign: updated.campaign,
      type: updated.type,
      value: updated.value,
      customerId: customerOid,
      stylistId: new Types.ObjectId(args.stylistId),
      reservationId: args.reservationId,
      originalPrice: args.originalPrice,
      priceBeforeCoupon: args.priceBeforeCoupon,
      discountAmount: args.discountAmount,
      finalPrice: args.finalPrice,
      platformFundedAmount: args.discountAmount,
      depositAmount: args.depositAmount,
    });
    return redemption._id;
  } catch (err) {
    // Redemption write failed → restore both counters (best-effort).
    await CouponCustomerUsage.updateOne(
      { couponId: couponOid, customerId: customerOid, usedCount: { $gt: 0 } },
      { $inc: { usedCount: -1 } },
    ).catch(() => undefined);
    await Coupon.updateOne(
      { _id: couponOid, usageCount: { $gt: 0 } },
      { $inc: { usageCount: -1 } },
    ).catch(() => undefined);
    throw err;
  }
}

/**
 * Idempotently undo a reservation's coupon redemption (failed hold creation,
 * payment start failure, unpaid hold release/expiry). No-op when the
 * reservation never redeemed a coupon.
 */
export async function releaseCouponUsage(reservationId: Types.ObjectId | string): Promise<void> {
  const id =
    typeof reservationId === 'string' ? new Types.ObjectId(reservationId) : reservationId;
  const redemption = await CouponRedemption.findOneAndDelete({ reservationId: id });
  if (!redemption) return;
  await Coupon.updateOne(
    { _id: redemption.couponId, usageCount: { $gt: 0 } },
    { $inc: { usageCount: -1 } },
  ).catch(() => undefined);
  await CouponCustomerUsage.updateOne(
    {
      couponId: redemption.couponId,
      customerId: redemption.customerId,
      usedCount: { $gt: 0 },
    },
    { $inc: { usedCount: -1 } },
  ).catch(() => undefined);
}

/** Exported for tests/ops: campaign cost summary. */
export async function getCouponCampaignSummary() {
  const [row] = await CouponRedemption.aggregate([
    {
      $group: {
        _id: null,
        totalRedemptions: { $sum: 1 },
        totalDiscount: { $sum: '$discountAmount' },
        totalFunding: { $sum: '$platformFundedAmount' },
      },
    },
  ]);
  return {
    totalRedemptions: row?.totalRedemptions ?? 0,
    totalDiscount: row?.totalDiscount ?? 0,
    totalFunding: row?.totalFunding ?? 0,
  };
}

export { COUPON_CAMPAIGN_TYPES };
