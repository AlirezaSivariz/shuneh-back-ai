import { Schema, model, Document, Types } from 'mongoose';

export type CreditTxReason =
  | 'completed_reservation'
  | 'five_star_review'
  | 'plan_purchase'
  | 'consecutive_cancellation_penalty'
  | 'admin_adjustment'
  | 'refund_rollback';

export const CREDIT_TX_REASONS: CreditTxReason[] = [
  'completed_reservation',
  'five_star_review',
  'plan_purchase',
  'consecutive_cancellation_penalty',
  'admin_adjustment',
  'refund_rollback',
];

export type CreditTxRefType = 'reservation' | 'review' | 'plan' | 'none';
export const CREDIT_TX_REF_TYPES: CreditTxRefType[] = ['reservation', 'review', 'plan', 'none'];

export interface ICreditTransaction extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  amount: number;
  balanceAfter: number;
  reason: CreditTxReason;
  referenceType: CreditTxRefType;
  referenceId: Types.ObjectId | null;
  description: string;
  metadata?: Record<string, unknown> | null;
  createdAt: Date;
}

const creditTransactionSchema = new Schema<ICreditTransaction>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true },
    balanceAfter: { type: Number, required: true },
    reason: { type: String, enum: CREDIT_TX_REASONS, required: true },
    referenceType: { type: String, enum: CREDIT_TX_REF_TYPES, default: 'none' },
    referenceId: { type: Schema.Types.ObjectId, default: null },
    description: { type: String, required: true },
    metadata: { type: Schema.Types.Mixed, default: null },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

creditTransactionSchema.index({ userId: 1, createdAt: -1 });
creditTransactionSchema.index({ referenceType: 1, referenceId: 1 });
// Admin list-all transactions sorted by createdAt.
creditTransactionSchema.index({ createdAt: -1 });

export const CreditTransaction = model<ICreditTransaction>(
  'CreditTransaction',
  creditTransactionSchema,
);
