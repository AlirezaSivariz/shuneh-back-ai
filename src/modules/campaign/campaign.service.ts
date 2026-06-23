/**
 * Stylist SMS discount-campaign feature (paid «نقره‌ای» plan; gated by
 * `StylistProfile.smsCampaignEnabled`). A stylist can blast ONE of THEIR OWN
 * discount codes to THEIR OWN past customers (or a manually-typed number). The
 * SMS text is server-built (stylist name + code + scope/expiry, incl. the actual
 * service name for service-specific codes) — the stylist never writes free text.
 * Anti-spam: per-send + per-day caps and same-code/same-number dedupe.
 */
import { createHash } from 'crypto';
import { Types } from 'mongoose';
import { StylistProfile } from '../../models/StylistProfile';
import { DiscountCode } from '../../models/DiscountCode';
import { Service } from '../../models/Service';
import { Reservation } from '../../models/Reservation';
import { User } from '../../models/User';
import { SmsCampaignLog } from '../../models/SmsCampaignLog';
import { AppError } from '../../utils/AppError';
import { smsProvider, toLimoMobile, maskMobile } from '../../utils/sms';
import { toJalaliLabel } from '../../utils/jalali';
import { config } from '../../config/env';

const DEDUPE_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Single-part Persian (UCS-2) SMS budget — keep the campaign text within one part. */
const SMS_SINGLE_PART = 70;

const toFa = (n: number | string) => String(n).replace(/\d/g, (d) => '۰۱۲۳۴۵۶۷۸۹'[Number(d)]);
const faToman = (n: number) => toFa(Math.trunc(n).toLocaleString('en-US').replace(/,/g, '،'));

/**
 * Build the discount-code SMS: short but clear — WHO it's from + the code + the
 * scope (for a service-specific code, the actual SERVICE NAME(S), not a generic
 * "خدمات منتخب") + optional expiry. Server-built (the stylist writes nothing).
 * To keep cost low it tries from richest to leanest within a single SMS part,
 * but the service name is always preserved (it's the point of the offer): we
 * drop the expiry, then collapse multiple names to «{first} و N خدمت دیگر», then
 * the stylist name — never the service name.
 */
export function buildCampaignMessage(input: {
  stylistName: string;
  code: string;
  type: 'percentage' | 'fixed';
  value: number;
  appliesTo: 'all' | 'services';
  serviceNames: string[];
  validUntil: Date | null | undefined;
}): string {
  const valueLabel =
    input.type === 'percentage' ? `${toFa(input.value)}٪` : `${faToman(input.value)} تومان`;
  const until = input.validUntil ? toJalaliLabel(input.validUntil.toISOString().slice(0, 10)) : null;

  const names = input.serviceNames.filter(Boolean);
  const fullScope =
    input.appliesTo === 'all'
      ? 'همه‌ی خدمات'
      : names.length === 0
        ? 'خدمات منتخب'
        : names.join('، ');
  const shortScope =
    input.appliesTo === 'all'
      ? 'همه‌ی خدمات'
      : names.length === 0
        ? 'خدمات منتخب'
        : names.length === 1
          ? names[0]
          : `${names[0]} و ${toFa(names.length - 1)} خدمت دیگر`;

  const build = (name: string, scope: string, withDate: boolean) =>
    `${name ? `${name}: ` : ''}کد ${input.code}، ${valueLabel} تخفیف روی ${scope}${withDate && until ? `، تا ${until}` : ''}. شونه`;

  // Richest → leanest; the service name (scope) is kept in every candidate.
  const candidates = [
    build(input.stylistName, fullScope, true),
    build(input.stylistName, fullScope, false),
    build(input.stylistName, shortScope, false),
    build('', shortScope, false),
  ];
  for (const c of candidates) if (c.length <= SMS_SINGLE_PART) return c;
  // Even the leanest exceeds one part (e.g. a long single service name) — send it
  // anyway; including the service name is the product priority.
  return candidates[candidates.length - 1];
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function phoneHashOf(normalizedPhone: string) {
  return createHash('sha256').update(normalizedPhone).digest('hex');
}

/** The campaign's plan/limit status for a stylist (drives the lock state + caps). */
export async function getStatus(stylistId: string) {
  const profile = await StylistProfile.findOne({ userId: stylistId })
    .select('smsCampaignEnabled')
    .lean();
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const sentToday = await SmsCampaignLog.countDocuments({
    stylistId,
    createdAt: { $gte: since },
  });
  return {
    enabled: profile?.smsCampaignEnabled ?? false,
    perSendMax: config.smsCampaignPerSendMax,
    dailyMax: config.smsCampaignDailyMax,
    sentToday,
    remainingToday: Math.max(0, config.smsCampaignDailyMax - sentToday),
  };
}

/**
 * The stylist's OWN past customers (distinct, by reservation), with name + phone.
 * Paginated + name/phone search. Only customers who actually booked this stylist
 * — never the full user base.
 */
export async function listCustomers(
  stylistId: string,
  opts: { search?: string; page?: number; limit?: number },
) {
  const page = Math.max(1, Math.floor(opts.page ?? 1));
  const limit = Math.min(100, Math.max(1, Math.floor(opts.limit ?? 30)));
  const skip = (page - 1) * limit;
  const oid = new Types.ObjectId(stylistId);

  const searchStage = opts.search
    ? [
        {
          $match: {
            $or: [
              { 'u.firstName': new RegExp(escapeRegex(opts.search), 'i') },
              { 'u.lastName': new RegExp(escapeRegex(opts.search), 'i') },
              { 'u.phone': new RegExp(escapeRegex(opts.search), 'i') },
            ],
          },
        },
      ]
    : [];

  const agg = await Reservation.aggregate([
    { $match: { stylistId: oid } },
    { $group: { _id: '$customerId', lastAt: { $max: '$startAt' }, reservations: { $sum: 1 } } },
    { $lookup: { from: 'users', localField: '_id', foreignField: '_id', as: 'u' } },
    { $unwind: '$u' },
    ...searchStage,
    { $sort: { lastAt: -1 } },
    {
      $facet: {
        items: [
          { $skip: skip },
          { $limit: limit },
          {
            $project: {
              _id: 0,
              id: { $toString: '$_id' },
              firstName: '$u.firstName',
              lastName: '$u.lastName',
              phone: '$u.phone',
              reservations: 1,
            },
          },
        ],
        total: [{ $count: 'n' }],
      },
    },
  ]);

  const facet = agg[0] ?? { items: [], total: [] };
  const total = facet.total[0]?.n ?? 0;
  const items = (facet.items as Array<{
    id: string;
    firstName?: string;
    lastName?: string;
    phone: string;
    reservations: number;
  }>).map((c) => ({
    id: c.id,
    fullName: `${c.firstName ?? ''} ${c.lastName ?? ''}`.trim() || 'مشتری',
    phone: c.phone,
    reservations: c.reservations,
  }));

  return { items, page, limit, total, totalPages: Math.ceil(total / limit) };
}

export interface SendInput {
  discountCodeId: string;
  customerIds?: string[];
  recipients?: { phone: string; name?: string }[];
}

/**
 * Send a discount code to chosen recipients. Enforces the plan gate, code
 * ownership, recipient validity, the per-send + per-day caps, and 24h dedupe.
 * SMS is best-effort via the gateway (logged in SmsLog); each attempt also gets
 * a SmsCampaignLog row for the quota/dedupe bookkeeping.
 */
export async function sendCampaign(stylistId: string, input: SendInput) {
  const oid = new Types.ObjectId(stylistId);

  // 1) Paid-plan gate.
  const profile = await StylistProfile.findOne({ userId: stylistId })
    .select('smsCampaignEnabled')
    .lean();
  if (!profile?.smsCampaignEnabled) {
    throw AppError.forbidden('این قابلیت برای حساب شما فعال نیست', 'SMS_CAMPAIGN_DISABLED');
  }

  // 2) The code must belong to THIS stylist.
  if (!Types.ObjectId.isValid(input.discountCodeId)) {
    throw AppError.badRequest('شناسه‌ی کد تخفیف نامعتبر', 'INVALID_ID');
  }
  const code = await DiscountCode.findOne({ _id: input.discountCodeId, stylistId })
    .select('code type value appliesTo serviceIds validUntil')
    .lean();
  if (!code) throw AppError.notFound('کد تخفیف یافت نشد', 'DISCOUNT_CODE_NOT_FOUND');

  // 3) Resolve recipients. customerIds are restricted to the stylist's own
  //    customers; manual recipients are taken as typed.
  const collected: { phone: string; name?: string }[] = [];
  if (input.customerIds?.length) {
    const candidateIds = input.customerIds.filter((id) => Types.ObjectId.isValid(id));
    const validIds = await Reservation.distinct('customerId', {
      stylistId: oid,
      customerId: { $in: candidateIds.map((id) => new Types.ObjectId(id)) },
    });
    const users = await User.find({ _id: { $in: validIds } })
      .select('firstName lastName phone')
      .lean();
    for (const u of users) {
      collected.push({
        phone: u.phone,
        name: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || undefined,
      });
    }
  }
  if (input.recipients?.length) {
    for (const r of input.recipients) collected.push({ phone: r.phone, name: r.name });
  }

  // Normalize + validate (Iranian mobile) + dedupe within this request.
  const seen = new Set<string>();
  const normalized: { phone: string; name?: string }[] = [];
  let invalid = 0;
  for (const r of collected) {
    const m = toLimoMobile(r.phone);
    if (!/^09\d{9}$/.test(m)) {
      invalid += 1;
      continue;
    }
    if (seen.has(m)) continue;
    seen.add(m);
    normalized.push({ phone: m, name: r.name });
  }
  if (normalized.length === 0) {
    throw AppError.badRequest('گیرنده‌ی معتبری انتخاب نشده است', 'NO_VALID_RECIPIENTS');
  }

  // 4) Per-send cap.
  if (normalized.length > config.smsCampaignPerSendMax) {
    throw AppError.badRequest(
      `در هر ارسال حداکثر ${config.smsCampaignPerSendMax} گیرنده مجاز است`,
      'TOO_MANY_RECIPIENTS',
    );
  }

  // 5) Per-day cap (rolling 24h).
  const since = new Date(Date.now() - DEDUPE_WINDOW_MS);
  const sentRecent = await SmsCampaignLog.countDocuments({ stylistId: oid, createdAt: { $gte: since } });
  if (sentRecent + normalized.length > config.smsCampaignDailyMax) {
    throw AppError.badRequest(
      `سقف ارسال روزانه (${config.smsCampaignDailyMax} پیامک) اجازه نمی‌دهد. امروز ${sentRecent} پیامک ارسال شده است.`,
      'DAILY_LIMIT_REACHED',
    );
  }

  // 6) Server-built, single-part message: who it's from + code + scope/expiry.
  //    For a service-specific code, resolve the actual service NAME(S).
  const [stylist, serviceDocs] = await Promise.all([
    User.findById(stylistId).select('firstName lastName').lean(),
    code.appliesTo === 'services' && code.serviceIds?.length
      ? Service.find({ _id: { $in: code.serviceIds } })
          .select('name')
          .lean()
      : Promise.resolve([] as { name: string }[]),
  ]);
  const stylistName = `${stylist?.firstName ?? ''} ${stylist?.lastName ?? ''}`.trim() || 'متخصص';
  const message = buildCampaignMessage({
    stylistName,
    code: code.code,
    type: code.type,
    value: code.value,
    appliesTo: code.appliesTo,
    serviceNames: serviceDocs.map((s) => s.name),
    validUntil: code.validUntil,
  });

  let queued = 0;
  let skipped = 0;
  const results: { phone: string; status: 'queued' | 'skipped_duplicate' }[] = [];
  for (const r of normalized) {
    const hash = phoneHashOf(r.phone);
    // Don't re-send the SAME code to the SAME number within the dedupe window.
    const dup = await SmsCampaignLog.exists({
      stylistId: oid,
      discountCodeId: code._id,
      phoneHash: hash,
      createdAt: { $gte: since },
    });
    if (dup) {
      skipped += 1;
      results.push({ phone: maskMobile(r.phone), status: 'skipped_duplicate' });
      continue;
    }
    // Best-effort send (never throws; records delivery in SmsLog).
    await smsProvider.send(r.phone, message, { event: 'discount_campaign' });
    await SmsCampaignLog.create({
      stylistId: oid,
      discountCodeId: code._id,
      phoneHash: hash,
      recipientMasked: maskMobile(r.phone),
      code: code.code,
      status: 'queued',
    });
    queued += 1;
    results.push({ phone: maskMobile(r.phone), status: 'queued' });
  }

  return {
    code: code.code,
    message,
    requested: collected.length,
    valid: normalized.length,
    invalid,
    queued,
    skipped,
    results,
  };
}
