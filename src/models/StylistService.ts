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
  /** Per-service portfolio images (storage keys), max 3. */
  portfolioImages: string[];
  /** Whether the first portfolio image appears on the public service card. */
  showPortfolioOnCard: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const stylistServiceSchema = new Schema<IStylistService>(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true, index: true },
    price: { type: Number, default: null, min: 0 },
    durationMin: { type: Number, default: null, min: 1 },
    portfolioImages: { type: [String], default: [] },
    showPortfolioOnCard: { type: Boolean, default: true },
  },
  { timestamps: true },
);

stylistServiceSchema.index({ stylistId: 1, serviceId: 1 }, { unique: true });

export const StylistService = model<IStylistService>('StylistService', stylistServiceSchema);
