import { Schema, model, Document, Types } from 'mongoose';

/**
 * A tip a customer records for a completed reservation.
 *
 * IMPORTANT: tips are real money but there is NO payment gateway yet. A tip is
 * recorded behind the (stub) payment interface and starts as 'recorded'. When a
 * gateway is wired up, the charge result will flip it to 'paid' (see
 * `payment.ts` TODO). One tip per reservation (unique index).
 */
export type TipStatus = 'pending' | 'paid' | 'recorded';

export interface ITip extends Document {
  _id: Types.ObjectId;
  reservationId: Types.ObjectId;
  customerId: Types.ObjectId;
  stylistId: Types.ObjectId;
  amount: number;
  status: TipStatus;
  createdAt: Date;
  updatedAt: Date;
}

const tipSchema = new Schema<ITip>(
  {
    reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true, unique: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    amount: { type: Number, required: true, min: 1 },
    status: { type: String, enum: ['pending', 'paid', 'recorded'], default: 'recorded' },
  },
  { timestamps: true },
);

export const Tip = model<ITip>('Tip', tipSchema);
