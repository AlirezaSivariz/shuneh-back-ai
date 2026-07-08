import { Schema, model, Document, Types } from 'mongoose';

export type SettlementStatus = 'pending' | 'approved' | 'paid' | 'rejected';

export const SETTLEMENT_STATUSES: SettlementStatus[] = [
  'pending',
  'approved',
  'paid',
  'rejected',
];

export interface IStylistSettlement extends Document {
  _id: Types.ObjectId;
  stylistId: Types.ObjectId;
  /** Amount the stylist requested (in Toman). */
  amount: number;
  /** Deposits that this settlement covers (reservation IDs). */
  depositReservationIds: Types.ObjectId[];
  status: SettlementStatus;
  adminNote?: string | null;
  /** Admin who processed this settlement. */
  processedBy?: Types.ObjectId | null;
  processedAt?: Date | null;
  /** When the settlement was actually paid. */
  paidAt?: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const stylistSettlementSchema = new Schema<IStylistSettlement>(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 0 },
    depositReservationIds: [{ type: Schema.Types.ObjectId, ref: 'Reservation' }],
    status: {
      type: String,
      enum: SETTLEMENT_STATUSES,
      default: 'pending',
      index: true,
    },
    adminNote: { type: String, default: null, maxlength: 500 },
    processedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    processedAt: { type: Date, default: null },
    paidAt: { type: Date, default: null },
  },
  { timestamps: true },
);

stylistSettlementSchema.index({ stylistId: 1, status: 1 });
stylistSettlementSchema.index({ status: 1, createdAt: -1 });

export const StylistSettlement = model<IStylistSettlement>(
  'StylistSettlement',
  stylistSettlementSchema,
);
