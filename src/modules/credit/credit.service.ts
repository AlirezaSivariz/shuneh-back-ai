import { Types } from 'mongoose';
import { CreditWallet } from '../../models/CreditWallet';
import { CreditTransaction, CreditTxReason } from '../../models/CreditTransaction';
import { CreditSetting } from '../../models/CreditSetting';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';

interface CreditSettings {
  completedReservationCredit: number;
  fiveStarReviewCredit: number;
  consecutiveCancelPenalty: number;
  consecutiveCancelThreshold: number;
  silverCreditPrice: number;
  goldCreditPrice: number;
  isEnabled: boolean;
}

let cachedSettings: CreditSettings | null = null;
let settingsCacheTime = 0;
const CACHE_TTL = 60_000;

export async function getCreditSettings(): Promise<CreditSettings> {
  if (cachedSettings && Date.now() - settingsCacheTime < CACHE_TTL) {
    return cachedSettings;
  }
  let doc = await CreditSetting.findOne().lean();
  if (!doc) {
    await CreditSetting.create({});
    doc = await CreditSetting.findOne().lean();
  }
  if (!doc) {
    return {
      completedReservationCredit: 25, fiveStarReviewCredit: 15,
      consecutiveCancelPenalty: 25, consecutiveCancelThreshold: 3,
      silverCreditPrice: 400, goldCreditPrice: 700, isEnabled: true,
    };
  }
  const settings: CreditSettings = {
    completedReservationCredit: doc.completedReservationCredit,
    fiveStarReviewCredit: doc.fiveStarReviewCredit,
    consecutiveCancelPenalty: doc.consecutiveCancelPenalty,
    consecutiveCancelThreshold: doc.consecutiveCancelThreshold,
    silverCreditPrice: doc.silverCreditPrice,
    goldCreditPrice: doc.goldCreditPrice,
    isEnabled: doc.isEnabled,
  };
  cachedSettings = settings;
  settingsCacheTime = Date.now();
  return settings;
}

export function invalidateSettingsCache(): void {
  cachedSettings = null;
  settingsCacheTime = 0;
}

export async function getWallet(userId: string) {
  if (!Types.ObjectId.isValid(userId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  let wallet = await CreditWallet.findOne({ userId }).lean();
  if (!wallet) {
    const user = await User.findById(userId).lean();
    if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');
    const created = await CreditWallet.findOneAndUpdate(
      { userId: new Types.ObjectId(userId) },
      { $setOnInsert: { userId: new Types.ObjectId(userId), balance: 0, totalEarned: 0, totalSpent: 0, version: 0 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    return { balance: created.balance, totalEarned: created.totalEarned, totalSpent: created.totalSpent };
  }
  return {
    balance: wallet.balance,
    totalEarned: wallet.totalEarned,
    totalSpent: wallet.totalSpent,
  };
}

export async function listTransactions(
  userId: string,
  page = 1,
  limit = 20,
) {
  if (!Types.ObjectId.isValid(userId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const p = Math.max(1, Math.floor(page) || 1);
  const l = Math.min(50, Math.max(1, Math.floor(limit) || 20));
  const skip = (p - 1) * l;
  const oid = new Types.ObjectId(userId);
  const [items, total] = await Promise.all([
    CreditTransaction.find({ userId: oid })
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(l)
      .lean(),
    CreditTransaction.countDocuments({ userId: oid }),
  ]);
  return {
    items: items.map((t) => ({
      id: String(t._id),
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      reason: t.reason,
      referenceType: t.referenceType,
      description: t.description,
      createdAt: t.createdAt,
    })),
    page: p,
    limit: l,
    total,
    totalPages: Math.ceil(total / l),
  };
}

export async function applyCreditChange(
  userId: string,
  input: {
    amount: number;
    reason: CreditTxReason;
    referenceType?: string;
    referenceId?: string | null;
    description: string;
    metadata?: Record<string, unknown> | null;
  },
) {
  if (!Types.ObjectId.isValid(userId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const amount = Math.trunc(input.amount);
  if (!Number.isFinite(amount) || amount === 0) {
    throw AppError.badRequest('مقدار نامعتبر است', 'INVALID_AMOUNT');
  }

  const settings = await getCreditSettings();
  if (!settings.isEnabled) {
    throw AppError.badRequest('سیستم اعتبار غیرفعال است', 'CREDIT_SYSTEM_DISABLED');
  }

  const oid = new Types.ObjectId(userId);

  if (amount > 0) {
    const wallet = await CreditWallet.findOneAndUpdate(
      { userId: oid },
      { $inc: { balance: amount, totalEarned: amount, version: 1 } },
      { upsert: true, new: true, setDefaultsOnInsert: true },
    );
    await CreditTransaction.create({
      userId: oid,
      amount,
      balanceAfter: wallet.balance,
      reason: input.reason,
      referenceType: (input.referenceType ?? 'none') as any,
      referenceId: input.referenceId ? new Types.ObjectId(input.referenceId) : null,
      description: input.description,
      metadata: input.metadata ?? null,
    });
    return { balance: wallet.balance, totalEarned: wallet.totalEarned, totalSpent: wallet.totalSpent };
  }

  const debitAmount = Math.abs(amount);
  // No balance guard here — penalty deductions must work even at 0 balance.
  // plan purchases have their own balance check in purchasePlanByCredit.
  const wallet = await CreditWallet.findOneAndUpdate(
    { userId: oid },
    { $inc: { balance: -debitAmount, totalSpent: debitAmount, version: 1 } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  await CreditTransaction.create({
    userId: oid,
    amount,
    balanceAfter: wallet.balance,
    reason: input.reason,
    referenceType: (input.referenceType ?? 'none') as any,
    referenceId: input.referenceId ? new Types.ObjectId(input.referenceId) : null,
    description: input.description,
    metadata: input.metadata ?? null,
  });
  return { balance: wallet.balance, totalEarned: wallet.totalEarned, totalSpent: wallet.totalSpent };
}

export async function purchasePlanByCredit(userId: string, tier: 'silver' | 'gold') {
  if (!Types.ObjectId.isValid(userId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const settings = await getCreditSettings();
  if (!settings.isEnabled) throw AppError.badRequest('سیستم اعتبار غیرفعال است', 'CREDIT_SYSTEM_DISABLED');

  const creditPrice = tier === 'silver' ? settings.silverCreditPrice : settings.goldCreditPrice;

  const oid = new Types.ObjectId(userId);

  const wallet = await CreditWallet.findOneAndUpdate(
    { userId: oid, balance: { $gte: creditPrice } },
    { $inc: { balance: -creditPrice, totalSpent: creditPrice, version: 1 } },
    { new: true },
  );
  if (!wallet) {
    const existing = await CreditWallet.findOne({ userId: oid });
    if (!existing) throw AppError.notFound('کیف اعتبار یافت نشد', 'WALLET_NOT_FOUND');
    throw AppError.badRequest(
      `اعتبار کافی نیست. نیاز: ${creditPrice} اعتبار`,
      'INSUFFICIENT_CREDIT',
    );
  }

  const { StylistProfile } = await import('../../models/StylistProfile');
  const { planExpiryDate } = await import('../../models/StylistProfile');
  await StylistProfile.updateOne(
    { userId: oid },
    {
      $set: {
        planTier: tier,
        planStartsAt: new Date(),
        planExpiresAt: planExpiryDate(),
        expiryRemindersSent: [],
      },
    },
  );

  const tierLabel = tier === 'silver' ? 'نقره‌ای' : 'طلایی';
  await CreditTransaction.create({
    userId: oid,
    amount: -creditPrice,
    balanceAfter: wallet.balance,
    reason: 'plan_purchase' as CreditTxReason,
    referenceType: 'plan',
    referenceId: null,
    description: `خرید پلن ${tierLabel}`,
    metadata: { tier, creditPrice },
  });

  return { balance: wallet.balance };
}

export async function awardCompletedReservation(stylistId: string, reservationId: string) {
  const settings = await getCreditSettings();
  if (!settings.isEnabled || settings.completedReservationCredit <= 0) return null;

  try {
    return await applyCreditChange(stylistId, {
      amount: settings.completedReservationCredit,
      reason: 'completed_reservation',
      referenceType: 'reservation',
      referenceId: reservationId,
      description: `تکمیل رزرو +${settings.completedReservationCredit} اعتبار`,
    });
  } catch {
    return null;
  }
}

export async function awardFiveStarReview(stylistId: string, reviewId: string) {
  const settings = await getCreditSettings();
  if (!settings.isEnabled || settings.fiveStarReviewCredit <= 0) return null;

  try {
    return await applyCreditChange(stylistId, {
      amount: settings.fiveStarReviewCredit,
      reason: 'five_star_review',
      referenceType: 'review',
      referenceId: reviewId,
      description: `امتیاز ۵ ستاره +${settings.fiveStarReviewCredit} اعتبار`,
    });
  } catch {
    return null;
  }
}

export async function applyCancellationPenalty(stylistId: string, reservationId: string) {
  const settings = await getCreditSettings();
  if (!settings.isEnabled || settings.consecutiveCancelPenalty <= 0) {
    return null;
  }

  const stylistOid = new Types.ObjectId(stylistId);

  const { Reservation } = await import('../../models/Reservation');
  const previousReservations = await Reservation.find({
    stylistId: stylistOid,
    _id: { $ne: new Types.ObjectId(reservationId) },
    status: { $in: ['completed', 'cancelled'] },
  })
    .select('status cancelledBy startAt')
    .sort({ startAt: -1 })
    .limit(10)
    .lean();

  let consecutiveCount = 0;
  for (const prev of previousReservations) {
    if (prev.status === 'cancelled' && prev.cancelledBy === 'stylist') {
      consecutiveCount++;
    } else if (prev.status === 'completed') {
      break;
    } else {
      break;
    }
  }

  if (consecutiveCount < settings.consecutiveCancelThreshold) {
    return null;
  }

  try {
    const result = await applyCreditChange(stylistId, {
      amount: -settings.consecutiveCancelPenalty,
      reason: 'consecutive_cancellation_penalty',
      referenceType: 'reservation',
      referenceId: reservationId,
      description: `${consecutiveCount + 1}امین لغو متوالی -${settings.consecutiveCancelPenalty} اعتبار`,
      metadata: { consecutiveCount: consecutiveCount + 1, threshold: settings.consecutiveCancelThreshold },
    });
    return result;
  } catch {
    return null;
  }
}

export async function adminAdjust(
  adminId: string,
  targetUserId: string,
  input: { amount: number; description: string },
) {
  return applyCreditChange(targetUserId, {
    amount: input.amount,
    reason: 'admin_adjustment',
    description: input.description,
    metadata: { adminId },
  });
}

export async function adminListUsers(page = 1, limit = 20, search?: string) {
  const p = Math.max(1, Math.floor(page) || 1);
  const l = Math.min(100, Math.max(1, Math.floor(limit) || 20));
  const skip = (p - 1) * l;

  const matchStage: Record<string, unknown> = {};
  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    matchStage['user.phone'] = { $regex: escaped, $options: 'i' };
  }

  const pipeline: any[] = [
    {
      $lookup: {
        from: 'users',
        localField: 'userId',
        foreignField: '_id',
        as: 'user',
      },
    },
    { $unwind: '$user' },
    { $match: { 'user.roles': { $in: ['stylist', 'owner'] } } },
  ];

  if (search) {
    const escaped = search.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    pipeline.push({ $match: { 'user.phone': { $regex: escaped, $options: 'i' } } });
  }

  const countPipeline = [...pipeline, { $count: 'total' }];
  const countResult = await CreditWallet.aggregate(countPipeline);
  const total = countResult[0]?.total ?? 0;

  pipeline.push(
    { $sort: { createdAt: -1 } },
    { $skip: skip },
    { $limit: l },
    {
      $project: {
        _id: 0,
        id: { $toString: '$_id' },
        userId: { $toString: '$userId' },
        balance: 1,
        totalEarned: 1,
        totalSpent: 1,
        userPhone: '$user.phone',
        userName: {
          $cond: [
            { $or: [{ $eq: ['$user.firstName', null] }, { $eq: ['$user.firstName', ''] }] },
            '$user.phone',
            { $concat: [{ $ifNull: ['$user.firstName', ''] }, ' ', { $ifNull: ['$user.lastName', ''] }] },
          ],
        },
      },
    },
  );

  const items = await CreditWallet.aggregate(pipeline);
  return { items, page: p, limit: l, total, totalPages: Math.ceil(total / l) };
}

export async function adminListUserTransactions(userId: string, page = 1, limit = 20) {
  return listTransactions(userId, page, limit);
}

export async function adminListAllTransactions(page = 1, limit = 20) {
  const p = Math.max(1, Math.floor(page) || 1);
  const l = Math.min(100, Math.max(1, Math.floor(limit) || 20));
  const skip = (p - 1) * l;

  const [items, total] = await Promise.all([
    CreditTransaction.find()
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(l)
      .lean(),
    CreditTransaction.countDocuments(),
  ]);

  return {
    items: items.map((t) => ({
      id: String(t._id),
      userId: String(t.userId),
      amount: t.amount,
      balanceAfter: t.balanceAfter,
      reason: t.reason,
      description: t.description,
      createdAt: t.createdAt,
    })),
    page: p,
    limit: l,
    total,
    totalPages: Math.ceil(total / l),
  };
}

export async function rollbackCredit(refType: 'reservation', refId: string) {
  const existing = await CreditTransaction.findOne({
    referenceType: refType,
    referenceId: new Types.ObjectId(refId),
    reason: { $ne: 'refund_rollback' },
  }).lean();
  if (!existing) return null;

  return applyCreditChange(String(existing.userId), {
    amount: -existing.amount,
    reason: 'refund_rollback',
    referenceType: refType,
    referenceId: refId,
    description: `بازگشت اعتبار (لغو تراکنش)`,
    metadata: { originalTxId: String(existing._id), originalReason: existing.reason },
  });
}
