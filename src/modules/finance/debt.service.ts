/**
 * Customer debt posting — the ONLY place a cancellation penalty is written to
 * `User.debtBalance`.
 *
 * A penalty is the customer's liability, not stylist income. Posting it here
 * (atomically with `$inc`) and locking at the configured threshold means a
 * repeat offender cannot keep booking while owing money.
 */
import { Types } from 'mongoose';
import { User } from '../../models/User';
import { config } from '../../config/env';
import { notificationService } from '../../utils/notification';

export interface PostedDebt {
  previousBalance: number;
  debtBalance: number;
  isDebtLocked: boolean;
  newlyLocked: boolean;
}

/**
 * Add `amount` to the customer's debt. Returns null when the customer does not
 * exist or the amount is not positive. Locks the account when the resulting
 * balance reaches `MAX_DEBT_THRESHOLD` and notifies them exactly once.
 */
export async function postCustomerDebt(
  customerId: Types.ObjectId | string,
  amount: number,
  reason: string,
): Promise<PostedDebt | null> {
  if (!Number.isFinite(amount) || amount <= 0) return null;
  const toPost = Math.round(amount);
  if (toPost <= 0) return null;

  // $inc is atomic: concurrent cancellations cannot lose a debt entry.
  const user = await User.findOneAndUpdate(
    { _id: customerId },
    { $inc: { debtBalance: toPost } },
    { new: true },
  ).select('debtBalance isDebtLocked phone');
  if (!user) return null;

  const previousBalance = Math.max(0, (user.debtBalance ?? 0) - toPost);
  const threshold = Math.max(0, config.maxDebtThreshold ?? 100_000);
  let newlyLocked = false;

  if (user.debtBalance >= threshold && !user.isDebtLocked) {
    const locked = await User.findOneAndUpdate(
      { _id: customerId, isDebtLocked: false },
      {
        $set: {
          isDebtLocked: true,
          debtLockedAt: new Date(),
          debtNote: reason.slice(0, 300),
        },
      },
      { new: true },
    ).select('phone debtBalance');
    newlyLocked = Boolean(locked);
    if (newlyLocked && locked?.phone) {
      void notificationService
        .debtLocked(locked.phone, {
          amount: locked.debtBalance,
          threshold,
        })
        .catch(() => undefined);
    }
  }

  return {
    previousBalance,
    debtBalance: user.debtBalance,
    isDebtLocked: newlyLocked || Boolean(user.isDebtLocked),
    newlyLocked,
  };
}
