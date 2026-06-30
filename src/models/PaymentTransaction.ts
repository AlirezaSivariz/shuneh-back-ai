import { Schema, model, Document, Types } from 'mongoose';

/**
 * A single gateway payment attempt (Zibal). Separate from the wallet ledger: the
 * gateway record tracks request → start → callback → verify, and links to the
 * WalletTransaction created ONLY after a successful verify. Generic `purpose` so
 * the same gateway serves wallet top-ups now and reservation deposits / plan /
 * promote purchases later.
 *
 * Amounts: `amountToman` is our canonical unit; `amountRial = amountToman * 10`
 * is what Zibal receives + returns.
 */
export type PaymentProviderName = 'zibal';

export type PaymentPurpose =
  | 'wallet_topup'
  | 'reservation_deposit'
  | 'plan_purchase'
  | 'promote_purchase';

export const PAYMENT_PURPOSES: PaymentPurpose[] = [
  'wallet_topup',
  'reservation_deposit',
  'plan_purchase',
  'promote_purchase',
];

/**
 * Lifecycle: initiated → pending (trackId issued, user at gateway) → paid
 * (callback + verify ok → business outcome applied) | failed.
 */
export type PaymentStatus = 'initiated' | 'pending' | 'paid' | 'failed';
export const PAYMENT_STATUSES: PaymentStatus[] = ['initiated', 'pending', 'paid', 'failed'];

export interface IPaymentTransaction extends Document {
  _id: Types.ObjectId;
  provider: PaymentProviderName;
  userId: Types.ObjectId;
  purpose: PaymentPurpose;
  amountToman: number;
  amountRial: number;
  /** Our unique order id (sent to Zibal as orderId). */
  orderId: string;
  /** Zibal's tracking id (from /v1/request). */
  trackId: string | null;
  status: PaymentStatus;
  /** Last Zibal result code (request or verify). */
  resultCode: number | null;
  message: string | null;
  /** Verify references for reconciliation. */
  refNumber: string | null;
  cardNumber: string | null;
  paidAt: Date | null;
  /** The wallet ledger entry created on success (wallet_topup). */
  walletTxId: Types.ObjectId | null;
  callbackUrl: string;
  /** Non-sensitive extra context (never store the merchant key here). */
  meta?: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

const paymentTransactionSchema = new Schema<IPaymentTransaction>(
  {
    provider: { type: String, required: true, default: 'zibal' },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    purpose: { type: String, enum: PAYMENT_PURPOSES, required: true },
    amountToman: { type: Number, required: true, min: 1 },
    amountRial: { type: Number, required: true, min: 1 },
    orderId: { type: String, required: true, unique: true },
    trackId: { type: String, default: null, index: true },
    status: { type: String, enum: PAYMENT_STATUSES, default: 'initiated', index: true },
    resultCode: { type: Number, default: null },
    message: { type: String, default: null },
    refNumber: { type: String, default: null },
    cardNumber: { type: String, default: null },
    paidAt: { type: Date, default: null },
    walletTxId: { type: Schema.Types.ObjectId, ref: 'WalletTransaction', default: null },
    callbackUrl: { type: String, required: true },
    meta: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: true },
);

export const PaymentTransaction = model<IPaymentTransaction>(
  'PaymentTransaction',
  paymentTransactionSchema,
);
