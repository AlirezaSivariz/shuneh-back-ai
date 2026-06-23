/**
 * Customer wallet: balance (cached on User), an append-only ledger
 * (WalletTransaction) and top-ups behind the (stub) payment seam.
 *
 * Money rules (whole-Toman integers everywhere):
 *  - A COMPLETED balance change and its ledger entry are written together in a
 *    Mongo transaction (`applyWalletChange`) so balance ↔ history never drift.
 *  - A top-up records a PENDING ledger entry and does NOT move the balance —
 *    there is no real gateway yet (see `payment.ts`).
 *  - `applyWalletChange` is the single seam future "charge wallet on booking" /
 *    "refund" / gateway-callback flows will call.
 */
import mongoose, { Types } from 'mongoose';
import { User } from '../../models/User';
import {
  WalletTransaction,
  WalletTxReason,
  IWalletTransaction,
} from '../../models/WalletTransaction';
import { AppError } from '../../utils/AppError';
import { paymentProvider } from '../../utils/payment';

export interface WalletChangeInput {
  type: 'credit' | 'debit';
  amount: number; // positive integer, whole Toman
  reason: WalletTxReason;
  meta?: Record<string, unknown> | null;
}

/**
 * Atomically apply a COMPLETED balance change and write its ledger entry. Debits
 * can never push the balance below zero. Returns the new balance + the ledger
 * transaction. THE single place that mutates `walletBalance`.
 */
export async function applyWalletChange(userId: string, input: WalletChangeInput) {
  if (!Types.ObjectId.isValid(userId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const amount = Math.trunc(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw AppError.badRequest('مبلغ نامعتبر است', 'INVALID_AMOUNT');
  }
  const delta = input.type === 'credit' ? amount : -amount;

  const session = await mongoose.startSession();
  try {
    let out: { balance: number; transaction: IWalletTransaction } | null = null;
    await session.withTransaction(async () => {
      const user = await User.findById(userId).session(session);
      if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');
      const current = user.walletBalance ?? 0;
      if (input.type === 'debit' && current < amount) {
        throw AppError.badRequest('موجودی کیف پول کافی نیست', 'INSUFFICIENT_BALANCE');
      }
      user.walletBalance = current + delta;
      await user.save({ session });
      const [tx] = await WalletTransaction.create(
        [
          {
            userId: user._id,
            type: input.type,
            amount,
            reason: input.reason,
            status: 'completed',
            meta: input.meta ?? null,
          },
        ],
        { session },
      );
      out = { balance: user.walletBalance, transaction: tx };
    });
    // withTransaction throws on failure, so `out` is always set on success.
    return out!;
  } finally {
    await session.endSession();
  }
}

/** Current balance + a small summary for the wallet header/sheet. */
export async function getWallet(userId: string) {
  const user = await User.findById(userId).select('walletBalance').lean();
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');
  const pendingTopups = await WalletTransaction.countDocuments({
    userId,
    reason: 'topup',
    status: 'pending',
  });
  return { balance: user.walletBalance ?? 0, currency: 'IRT', pendingTopups };
}

/** Paginated transaction history (newest first), scoped to the user. */
export async function listTransactions(userId: string, page = 1, limit = 20) {
  const p = Math.max(1, Math.floor(page) || 1);
  const l = Math.min(50, Math.max(1, Math.floor(limit) || 20));
  const skip = (p - 1) * l;
  const [rows, total] = await Promise.all([
    WalletTransaction.find({ userId }).sort({ createdAt: -1 }).skip(skip).limit(l).lean(),
    WalletTransaction.countDocuments({ userId }),
  ]);
  return {
    items: rows.map((t) => ({
      id: String(t._id),
      type: t.type,
      amount: t.amount,
      reason: t.reason,
      status: t.status,
      createdAt: t.createdAt,
    })),
    page: p,
    limit: l,
    total,
    totalPages: Math.ceil(total / l),
  };
}

/**
 * Start a wallet top-up. With no real gateway, this records a PENDING 'topup'
 * ledger entry and DOES NOT change the balance (no money has moved). The
 * response is explicit about that so the client never promises a real charge.
 */
export async function startTopup(userId: string, amount: number) {
  const amt = Math.trunc(amount);
  if (!Number.isFinite(amt) || amt <= 0) throw AppError.badRequest('مبلغ نامعتبر است', 'INVALID_AMOUNT');

  const init = await paymentProvider.startWalletTopup({ userId, amount: amt });
  const tx = await WalletTransaction.create({
    userId: new Types.ObjectId(userId),
    type: 'credit',
    amount: amt,
    reason: 'topup',
    status: 'pending',
    meta: { reference: init.reference, paymentUrl: init.paymentUrl },
  });

  return {
    transaction: { id: String(tx._id), amount: amt, status: tx.status, createdAt: tx.createdAt },
    paymentUrl: init.paymentUrl,
    // Honest signal: the gateway isn't connected, so the balance is unchanged.
    gatewayConnected: init.paymentUrl !== null,
    message:
      'درخواست افزایش موجودی ثبت شد. اتصال درگاه پرداخت هنوز فعال نیست؛ پس از فعال‌سازی، مبلغ به کیف پول اضافه می‌شود.',
  };
}
