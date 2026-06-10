import { Schema, model, Document, Types } from 'mongoose';

export type StylistSalonStatus = 'pending' | 'active' | 'rejected';

/**
 * Junction: stylist <-> salon membership. The salon owner approves (active).
 */
export interface IStylistSalon extends Document {
  stylistId: Types.ObjectId;
  salonId: Types.ObjectId;
  status: StylistSalonStatus;
  createdAt: Date;
  updatedAt: Date;
}

const stylistSalonSchema = new Schema<IStylistSalon>(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salonId: { type: Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    status: { type: String, enum: ['pending', 'active', 'rejected'], default: 'pending' },
  },
  { timestamps: true },
);

stylistSalonSchema.index({ stylistId: 1, salonId: 1 }, { unique: true });

export const StylistSalon = model<IStylistSalon>('StylistSalon', stylistSalonSchema);
