import { Schema, model, Document, Types } from 'mongoose';

/**
 * Append-only ledger of every wallet balance change. The user's
 * `User.walletBalance` is a cached running total; this collection is the full
 * history and the source of truth. A balance change and its ledger entry are
 * always written together, atomically (see `wallet.service.applyWalletChange`).
 *
 * All amounts are POSITIVE integers in whole Toman; `type` carries the
 * direction. `status` lets a charge sit as 'pending' (e.g. a top-up awaiting the
 * payment gateway) without touching the balance — only 'completed' entries are
 * reflected in `walletBalance`.
 */
export type WalletTxType = 'credit' | 'debit';
export const WALLET_TX_TYPES: WalletTxType[] = ['credit', 'debit'];

export type WalletTxReason = 'topup' | 'reservation' | 'refund' | 'admin_adjust';
export const WALLET_TX_REASONS: WalletTxReason[] = [
  'topup',
  'reservation',
  'refund',
  'admin_adjust',
];

export type WalletTxStatus = 'pending' | 'completed' | 'failed';
export const WALLET_TX_STATUSES: WalletTxStatus[] = ['pending', 'completed', 'failed'];

export interface IWalletTransaction extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  type: WalletTxType;
  /** Positive integer, whole Toman. */
  amount: number;
  reason: WalletTxReason;
  status: WalletTxStatus;
  /** Free-form context (gateway reference, admin note, reservationId, …). */
  meta?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const walletTransactionSchema = new Schema<IWalletTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: WALLET_TX_TYPES, required: true },
    amount: { type: Number, required: true, min: 1 },
    reason: { type: String, enum: WALLET_TX_REASONS, required: true },
    status: { type: String, enum: WALLET_TX_STATUSES, default: 'completed', index: true },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

// History queries: a user's transactions, newest first.
walletTransactionSchema.index({ userId: 1, createdAt: -1 });

export const WalletTransaction = model<IWalletTransaction>(
  'WalletTransaction',
  walletTransactionSchema,
);
