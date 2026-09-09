import { Types } from 'mongoose';
import { User } from '../../models/User';
import { Referral } from '../../models/Referral';
import { AppError } from '../../utils/AppError';
import { getCreditSettings, applyCreditChange } from '../credit/credit.service';

/** Unambiguous charset (no 0/O, 1/I/l) for codes that are read/typed/read aloud. */
const CODE_ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const CODE_LENGTH = 6;

function randomCode(): string {
  let out = '';
  const bytes = new Uint8Array(CODE_LENGTH);
  if (typeof crypto !== 'undefined' && typeof crypto.getRandomValues === 'function') {
    crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < CODE_LENGTH; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  for (let i = 0; i < CODE_LENGTH; i++) {
    out += CODE_ALPHABET[bytes[i] % CODE_ALPHABET.length];
  }
  return out;
}

/**
 * Generate a unique referral code for a user (idempotent + concurrent-safe under
 * the partial-unique index). Returns the existing code when present.
 */
export async function ensureReferralCode(userId: string): Promise<string> {
  if (!Types.ObjectId.isValid(userId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');

  const existing = await User.findById(userId).select('referralCode').lean();
  if (existing?.referralCode) return existing.referralCode;

  // Read-then-write with a retry loop; the partial-unique index is the backstop
  // for the rare 2.1B-to-1 random collision under concurrency.
  for (let attempt = 0; attempt < 6; attempt++) {
    const code = randomCode();
    const updated = await User.findOneAndUpdate(
      { _id: userId, $or: [{ referralCode: null }, { referralCode: { $exists: false } }] },
      { $set: { referralCode: code } },
      { new: true },
    ).catch(() => null);
    if (updated?.referralCode) return updated.referralCode;
    const recheck = await User.findById(userId).select('referralCode').lean();
    if (recheck?.referralCode) return recheck.referralCode;
    // Race: someone else set it, or a 11000 on this code — loop with a fresh code.
  }
  throw AppError.badRequest('ایجاد کد دعوت ممکن نشد؛ دوباره تلاش کنید', 'REFERRAL_CODE_GENERATION_FAILED');
}

/** The authenticated user's own referral card (code + how many they invited). */
export async function getMyReferral(userId: string) {
  if (!Types.ObjectId.isValid(userId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const code = await ensureReferralCode(userId);
  const inviteCount = await Referral.countDocuments({ referrerId: new Types.ObjectId(userId) });
  return { referralCode: code, inviteCount };
}

/**
 * Establish the one-time referral relationship for a referee who supplied a
 * referral code, and reward the referrer once their profile is complete.
 *
 * Guarantees (server-enforced + DB-enforced):
 *  - Self-referral rejected.
 *  - Referral code must belong to an existing user.
 *  - A referee (customer) can be referred EXACTLY once — unique `refereeId`
 *    index + 11000 catch is the concurrency guard against parallel claims.
 *  - The referrer can never be changed later.
 */
export async function claimReferral(refereeId: string, codeInput: string) {
  if (!Types.ObjectId.isValid(refereeId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');

  const referee = await User.findById(refereeId).lean();
  if (!referee) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');
  // Referral is finalized at profile completion.
  if (!referee.firstName) {
    throw AppError.badRequest(
      'ابتدا اطلاعات فردی خود را تکمیل کنید تا کد دعوت اعمال شود',
      'PROFILE_NOT_COMPLETE',
    );
  }
  if (referee.referredBy) {
    throw AppError.badRequest('نمی‌توانید دوباره با کد دعوت ثبت‌نام کنید', 'ALREADY_REFERRED');
  }

  const code = (codeInput ?? '').trim().toUpperCase();
  if (!code) throw AppError.badRequest('کد دعوت را وارد کنید', 'REFERRAL_CODE_REQUIRED');

  // Invalid / self-referral share the same generic message so a code can't be
  // probed to learn a user's identity.
  const referrer = await User.findOne({ referralCode: code }).select('_id').lean();
  if (!referrer || String(referrer._id) === String(refereeId)) {
    throw AppError.badRequest('کد دعوت معتبر نیست', 'INVALID_REFERRAL_CODE');
  }

  const settings = await getCreditSettings();
  const rewardAmount = settings.referralRewardAmount ?? 0;

  let referral: import('mongoose').Document<unknown, any, any> | null = null;
  try {
    referral = await Referral.create({
      referrerId: referrer._id,
      refereeId: new Types.ObjectId(refereeId),
      rewardAmount,
      referralCode: code,
      status: 'rewarded',
    });
  } catch (err) {
    if ((err as { code?: number }).code === 11000) {
      // Already referred — the unique refereeId index is authoritative.
      throw AppError.badRequest('نمی‌توانید دوباره با کد دعوت ثبت‌نام کنید', 'ALREADY_REFERRED');
    }
    throw err;
  }

  // Record the relationship on the referee (display only) — one-time, immutable.
  await User.updateOne({ _id: refereeId }, { $set: { referredBy: referrer._id } });

  let reward: { balance: number; totalEarned: number; totalSpent: number } | null = null;
  if (rewardAmount > 0 && settings.isEnabled) {
    try {
      reward = await applyCreditChange(String(referrer._id), {
        amount: rewardAmount,
        reason: 'referral',
        referenceType: 'referral',
        referenceId: String((referral as unknown as { _id: Types.ObjectId })._id),
        description: `هدیه دعوت دوستان +${rewardAmount} تومان`,
        metadata: { refereeId, referralCode: code },
      });
    } catch {
      // Reward failure must never block the referral itself — the relationship
      // stands; admin can adjust credit manually if needed.
      reward = null;
    }
  }

  return {
    referralCode: code,
    rewardAmount: reward?.balance != null ? rewardAmount : 0,
  };
}

/** Idempotent claim used on profile completion (never throws on already-referred). */
export async function claimReferralIfApplicable(refereeId: string, codeInput?: string | null) {
  if (!codeInput || !codeInput.trim()) return null;
  try {
    return await claimReferral(refereeId, codeInput);
  } catch {
    // An invalid/duplicate code must never block the profile save — the user can
    // retry explicitly from their profile page for clear feedback.
    return null;
  }
}