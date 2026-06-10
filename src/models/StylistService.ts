import { Schema, model, Document, Types } from 'mongoose';

/**
 * Junction: which services a stylist offers, with optional per-stylist
 * price / duration overrides (null = inherit from the Service defaults).
 */
export interface IStylistService extends Document {
  stylistId: Types.ObjectId;
  serviceId: Types.ObjectId;
  price: number | null;
  durationMin: number | null;
  createdAt: Date;
  updatedAt: Date;
}

const stylistServiceSchema = new Schema<IStylistService>(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
    price: { type: Number, default: null, min: 0 },
    durationMin: { type: Number, default: null, min: 1 },
  },
  { timestamps: true },
);

stylistServiceSchema.index({ stylistId: 1, serviceId: 1 }, { unique: true });

export const StylistService = model<IStylistService>('StylistService', stylistServiceSchema);
