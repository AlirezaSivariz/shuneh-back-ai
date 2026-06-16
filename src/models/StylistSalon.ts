import { Schema, model, Document, Types } from 'mongoose';

export type StylistSalonStatus = 'pending' | 'active' | 'rejected';
/** Who initiated the membership — decides who must approve the pending request. */
export type StylistSalonRequestedBy = 'stylist' | 'owner';

/**
 * Junction: stylist <-> salon membership.
 * - requestedBy='stylist' (default): the stylist asked to join → the OWNER approves.
 * - requestedBy='owner': the owner invited the stylist → the STYLIST accepts.
 */
export interface IStylistSalon extends Document {
  stylistId: Types.ObjectId;
  salonId: Types.ObjectId;
  status: StylistSalonStatus;
  requestedBy: StylistSalonRequestedBy;
  createdAt: Date;
  updatedAt: Date;
}

const stylistSalonSchema = new Schema<IStylistSalon>(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salonId: { type: Schema.Types.ObjectId, ref: 'Salon', required: true, index: true },
    status: { type: String, enum: ['pending', 'active', 'rejected'], default: 'pending' },
    requestedBy: { type: String, enum: ['stylist', 'owner'], default: 'stylist' },
  },
  { timestamps: true },
);

stylistSalonSchema.index({ stylistId: 1, salonId: 1 }, { unique: true });

export const StylistSalon = model<IStylistSalon>('StylistSalon', stylistSalonSchema);
