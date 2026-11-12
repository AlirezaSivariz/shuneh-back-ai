/**
 * Advertisement campaigns (admin CRUD + public display / frequency tracking).
 *
 * Frequency is enforced server-side per viewer:
 *  - `AdView` stores one row per (advertisement, viewer) with the last display
 *    time and the number of impressions. The unique index makes concurrent
 *    claims safe.
 *  - `displayIntervalMinutes` is the minimum gap between two displays.
 *  - `maxImpressionsPerUser` and `maxImpressionsTotal` are optional caps.
 *
 * Impressions are only counted when the client explicitly claims one (after
 * deciding to show the modal), so analytics stay accurate. Clicks increment a
 * simple counter on the campaign.
 */
import { Types } from 'mongoose';
import {
  Advertisement,
  IAdvertisement,
  AdAudience,
} from '../../models/Advertisement';
import { AdView } from '../../models/AdView';
import { AuditLog } from '../../models/AuditLog';
import { Role } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { storageProvider } from '../../utils/storage';

const PAGE_SIZE = 20;
const IRAN_OFFSET_MS = (3 * 60 + 30) * 60 * 1000;

export interface AdvertisementInput {
  title?: string | null;
  description?: string | null;
  image?: string;
  destinationUrl?: string;
  ctaText?: string | null;
  audience?: AdAudience;
  startDate?: string | null;
  endDate?: string | null;
  isActive?: boolean;
  displayIntervalMinutes?: number;
  maxImpressionsPerUser?: number;
  maxImpressionsTotal?: number;
}

export interface ViewerContext {
  viewerKey: string;
  userId?: string;
  roles?: Role[];
}

export type AdminAdStatus = 'active' | 'inactive' | 'scheduled' | 'ended';

// ─────────────────────────────── helpers ───────────────────────────────

function startOfIranDay(iso: string): Date {
  return new Date(`${iso}T00:00:00.000+03:30`);
}

function endOfIranDay(iso: string): Date {
  return new Date(`${iso}T23:59:59.999+03:30`);
}

/** Convert a stored instant to the Iran calendar day ("YYYY-MM-DD"). */
function iranDateOnly(date: Date | null): string | null {
  if (!date) return null;
  return new Date(date.getTime() + IRAN_OFFSET_MS).toISOString().slice(0, 10);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function statusOf(ad: IAdvertisement, now = new Date()): AdminAdStatus {
  if (!ad.isActive) return 'inactive';
  if (ad.startsAt && ad.startsAt.getTime() > now.getTime()) return 'scheduled';
  if (ad.endsAt && ad.endsAt.getTime() < now.getTime()) return 'ended';
  return 'active';
}

function allowedAudiences(roles?: Role[]): AdAudience[] {
  const allowed: AdAudience[] = ['all'];
  if (!roles?.length) return allowed;
  if (roles.includes('customer')) allowed.push('customers');
  if (roles.includes('stylist') || roles.includes('owner')) allowed.push('specialists');
  return allowed;
}

function isLive(ad: IAdvertisement, roles?: Role[], now = new Date()): boolean {
  if (!ad.isActive) return false;
  if (!allowedAudiences(roles).includes(ad.audience)) return false;
  if (ad.startsAt && ad.startsAt.getTime() > now.getTime()) return false;
  if (ad.endsAt && ad.endsAt.getTime() < now.getTime()) return false;
  if (ad.maxImpressionsTotal > 0 && ad.impressions >= ad.maxImpressionsTotal) return false;
  return true;
}

async function audit(
  adminId: string,
  action: string,
  targetId: string,
  summary: Record<string, unknown>,
): Promise<void> {
  try {
    await AuditLog.create({
      adminId: new Types.ObjectId(adminId),
      action,
      targetType: 'advertisement',
      targetId,
      summary,
    });
  } catch {
    /* auditing must not break the action */
  }
}

function toAdmin(ad: IAdvertisement) {
  return {
    id: String(ad._id),
    title: ad.title,
    description: ad.description,
    imageKey: ad.image,
    imageUrl: storageProvider.getUrl(ad.image),
    destinationUrl: ad.destinationUrl,
    ctaText: ad.ctaText,
    audience: ad.audience,
    startDate: iranDateOnly(ad.startsAt),
    endDate: iranDateOnly(ad.endsAt),
    isActive: ad.isActive,
    displayIntervalMinutes: ad.displayIntervalMinutes,
    maxImpressionsPerUser: ad.maxImpressionsPerUser,
    maxImpressionsTotal: ad.maxImpressionsTotal,
    impressions: ad.impressions,
    clicks: ad.clicks,
    status: statusOf(ad),
    createdAt: ad.createdAt,
    updatedAt: ad.updatedAt,
  };
}

export function toPublic(ad: IAdvertisement) {
  return {
    id: String(ad._id),
    title: ad.title,
    description: ad.description,
    imageUrl: storageProvider.getUrl(ad.image),
    destinationUrl: ad.destinationUrl,
    ctaText: ad.ctaText,
    audience: ad.audience,
    displayIntervalMinutes: ad.displayIntervalMinutes,
  };
}

// ─────────────────────────────── admin ─────────────────────────────────

export async function listAdvertisements(params: {
  search?: string;
  audience?: AdAudience;
  isActive?: boolean;
  page?: number;
  limit?: number;
}) {
  const page = Math.max(1, params.page ?? 1);
  const limit = Math.min(100, Math.max(1, params.limit ?? PAGE_SIZE));
  const skip = (page - 1) * limit;

  const filter: Record<string, unknown> = {};
  if (params.search?.trim()) {
    const rx = new RegExp(escapeRegex(params.search.trim()), 'i');
    filter.$or = [{ title: rx }, { description: rx }, { destinationUrl: rx }];
  }
  if (params.audience) filter.audience = params.audience;
  if (params.isActive !== undefined) filter.isActive = params.isActive;

  const now = new Date();
  const [items, total, activeNow, scheduled, ended, totals] = await Promise.all([
    Advertisement.find(filter).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Advertisement.countDocuments(filter),
    Advertisement.countDocuments({
      isActive: true,
      $and: [
        { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
        { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      ],
    }),
    Advertisement.countDocuments({ isActive: true, startsAt: { $gt: now } }),
    Advertisement.countDocuments({ isActive: true, endsAt: { $lt: now } }),
    Advertisement.aggregate<{ _id: null; impressions: number; clicks: number }>([
      { $group: { _id: null, impressions: { $sum: '$impressions' }, clicks: { $sum: '$clicks' } } },
    ]),
  ]);

  return {
    items: items.map(toAdmin),
    page,
    limit,
    total,
    totalPages: Math.max(1, Math.ceil(total / limit)),
    summary: {
      total: await Advertisement.countDocuments(),
      activeNow,
      scheduled,
      ended,
      totalImpressions: totals[0]?.impressions ?? 0,
      totalClicks: totals[0]?.clicks ?? 0,
    },
  };
}

export async function createAdvertisement(adminId: string, data: AdvertisementInput) {
  if (!data.image) throw AppError.badRequest('تصویر تبلیغ لازم است', 'IMAGE_REQUIRED');
  if (!data.destinationUrl) {
    throw AppError.badRequest('نشانی مقصد تبلیغ لازم است', 'DESTINATION_REQUIRED');
  }

  const ad = await Advertisement.create({
    title: data.title ?? null,
    description: data.description ?? null,
    image: data.image,
    destinationUrl: data.destinationUrl,
    ctaText: data.ctaText?.trim() || 'مشاهده',
    audience: data.audience ?? 'all',
    startsAt: data.startDate ? startOfIranDay(data.startDate) : null,
    endsAt: data.endDate ? endOfIranDay(data.endDate) : null,
    isActive: data.isActive ?? true,
    displayIntervalMinutes: data.displayIntervalMinutes ?? 60,
    maxImpressionsPerUser: data.maxImpressionsPerUser ?? 0,
    maxImpressionsTotal: data.maxImpressionsTotal ?? 0,
    createdBy: new Types.ObjectId(adminId),
  });

  await audit(adminId, 'advertisement.create', String(ad._id), {
    title: ad.title,
    audience: ad.audience,
  });
  return toAdmin(ad);
}

export async function updateAdvertisement(
  adminId: string,
  id: string,
  data: AdvertisementInput,
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const ad = await Advertisement.findById(id);
  if (!ad) throw AppError.notFound('تبلیغ یافت نشد', 'ADVERTISEMENT_NOT_FOUND');

  if (data.title !== undefined) ad.title = data.title?.trim() || null;
  if (data.description !== undefined) ad.description = data.description?.trim() || null;
  if (data.destinationUrl !== undefined) ad.destinationUrl = data.destinationUrl;
  if (data.ctaText !== undefined) ad.ctaText = data.ctaText?.trim() || 'مشاهده';
  if (data.audience !== undefined) ad.audience = data.audience;
  if (data.isActive !== undefined) ad.isActive = data.isActive;
  if (data.displayIntervalMinutes !== undefined) {
    ad.displayIntervalMinutes = data.displayIntervalMinutes;
  }
  if (data.maxImpressionsPerUser !== undefined) {
    ad.maxImpressionsPerUser = data.maxImpressionsPerUser;
  }
  if (data.maxImpressionsTotal !== undefined) ad.maxImpressionsTotal = data.maxImpressionsTotal;

  if (data.startDate !== undefined) {
    ad.startsAt = data.startDate ? startOfIranDay(data.startDate) : null;
  }
  if (data.endDate !== undefined) {
    ad.endsAt = data.endDate ? endOfIranDay(data.endDate) : null;
  }

  if (ad.startsAt && ad.endsAt && ad.startsAt.getTime() > ad.endsAt.getTime()) {
    throw AppError.badRequest(
      'تاریخ شروع باید قبل از تاریخ پایان باشد',
      'INVALID_DATE_RANGE',
    );
  }

  if (data.image !== undefined && data.image !== ad.image) {
    const oldKey = ad.image;
    ad.image = data.image;
    if (oldKey) await storageProvider.delete(oldKey).catch(() => undefined);
  }

  await ad.save();
  await audit(adminId, 'advertisement.update', id, { fields: Object.keys(data) });
  return toAdmin(ad);
}

export async function setAdvertisementStatus(adminId: string, id: string, isActive: boolean) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const ad = await Advertisement.findByIdAndUpdate(id, { $set: { isActive } }, { new: true });
  if (!ad) throw AppError.notFound('تبلیغ یافت نشد', 'ADVERTISEMENT_NOT_FOUND');
  await audit(adminId, 'advertisement.setStatus', id, { isActive });
  return toAdmin(ad);
}

export async function removeAdvertisement(adminId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const ad = await Advertisement.findById(id);
  if (!ad) throw AppError.notFound('تبلیغ یافت نشد', 'ADVERTISEMENT_NOT_FOUND');

  if (ad.image) await storageProvider.delete(ad.image).catch(() => undefined);
  await AdView.deleteMany({ advertisement: ad._id });
  await ad.deleteOne();
  await audit(adminId, 'advertisement.delete', id, { title: ad.title });
  return { id };
}

// ─────────────────────────────── public ────────────────────────────────

/** The next eligible campaign for this viewer, or null. Does not claim it. */
export async function pickNext(viewer: ViewerContext): Promise<IAdvertisement | null> {
  const now = new Date();
  const candidates = await Advertisement.find({
    isActive: true,
    audience: { $in: allowedAudiences(viewer.roles) },
    $and: [
      { $or: [{ startsAt: null }, { startsAt: { $lte: now } }] },
      { $or: [{ endsAt: null }, { endsAt: { $gte: now } }] },
      {
        $or: [
          { maxImpressionsTotal: 0 },
          { $expr: { $lt: ['$impressions', '$maxImpressionsTotal'] } },
        ],
      },
    ],
  })
    .sort({ createdAt: -1 })
    .limit(20);

  if (candidates.length === 0) return null;

  const views = await AdView.find({
    viewerKey: viewer.viewerKey,
    advertisement: { $in: candidates.map((ad) => ad._id) },
  });
  const byAd = new Map(views.map((view) => [String(view.advertisement), view]));

  for (const ad of candidates) {
    const view = byAd.get(String(ad._id));
    if (view) {
      if (ad.maxImpressionsPerUser > 0 && view.impressions >= ad.maxImpressionsPerUser) {
        continue;
      }
      const gapMs = ad.displayIntervalMinutes * 60_000;
      if (now.getTime() - view.lastShownAt.getTime() < gapMs) continue;
    }
    return ad;
  }
  return null;
}

/**
 * Atomically claim one impression for a viewer. Returns false when the
 * campaign is no longer eligible or another tab won the race.
 */
export async function recordImpression(
  id: string,
  viewer: ViewerContext,
): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const ad = await Advertisement.findById(id);
  if (!ad || !isLive(ad, viewer.roles)) return false;

  const now = new Date();
  const enforceTotal = ad.maxImpressionsTotal > 0;

  if (enforceTotal) {
    const claimed = await Advertisement.updateOne(
      { _id: ad._id, impressions: { $lt: ad.maxImpressionsTotal } },
      { $inc: { impressions: 1 } },
    );
    if (claimed.modifiedCount !== 1) return false;
  } else {
    await Advertisement.updateOne({ _id: ad._id }, { $inc: { impressions: 1 } });
  }

  const rollbackTotal = async () => {
    // The campaign counter is incremented optimistically; undo it whenever the
    // viewer claim loses a race or violates a frequency cap.
    await Advertisement.updateOne(
      { _id: ad._id, impressions: { $gt: 0 } },
      { $inc: { impressions: -1 } },
    ).catch(() => undefined);
  };

  const userId = viewer.userId && Types.ObjectId.isValid(viewer.userId)
    ? new Types.ObjectId(viewer.userId)
    : null;

  const view = await AdView.findOne({ advertisement: ad._id, viewerKey: viewer.viewerKey });

  if (!view) {
    try {
      await AdView.create({
        advertisement: ad._id,
        viewerKey: viewer.viewerKey,
        userId,
        impressions: 1,
        lastShownAt: now,
      });
    } catch {
      // Unique index collision → another request claimed it first.
      await rollbackTotal();
      return false;
    }
    return true;
  }

  if (ad.maxImpressionsPerUser > 0 && view.impressions >= ad.maxImpressionsPerUser) {
    await rollbackTotal();
    return false;
  }

  const gapMs = ad.displayIntervalMinutes * 60_000;
  if (now.getTime() - view.lastShownAt.getTime() < gapMs) {
    await rollbackTotal();
    return false;
  }

  const claimed = await AdView.updateOne(
    { _id: view._id, impressions: view.impressions, lastShownAt: view.lastShownAt },
    { $set: { lastShownAt: now, userId }, $inc: { impressions: 1 } },
  );
  if (claimed.modifiedCount !== 1) {
    await rollbackTotal();
    return false;
  }
  return true;
}

/** Record a click (best effort; navigation must never be blocked by tracking). */
export async function recordClick(id: string): Promise<boolean> {
  if (!Types.ObjectId.isValid(id)) return false;
  const ad = await Advertisement.findByIdAndUpdate(id, { $inc: { clicks: 1 } });
  return !!ad;
}
