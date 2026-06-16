import { Schema, model, Document, Types } from 'mongoose';

export type SalonInviteStatus = 'pending' | 'completed' | 'expired';

/**
 * Invite sent to the *real* owner of a salon that a stylist registered on their
 * behalf. The owner follows BASE_URL/invite/:token to claim & confirm the salon.
 */
export interface ISalonInvite extends Document {
  token: string;
  targetPhone: string;
  requestedBy: Types.ObjectId; // stylist
  salonId: Types.ObjectId; // pending salon
  salonDraft?: Record<string, unknown>;
  status: SalonInviteStatus;
  expiresAt: Date;
  /** Last time the invite SMS was sent — used to rate-limit resends. */
  lastSentAt?: Date;
  createdAt: Date;
  updatedAt: Date;
}

const salonInviteSchema = new Schema<ISalonInvite>(
  {
    token: { type: String, required: true, unique: true, index: true },
    targetPhone: { type: String, required: true, index: true },
    requestedBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    salonId: { type: Schema.Types.ObjectId, ref: 'Salon', required: true },
    salonDraft: { type: Schema.Types.Mixed },
    status: { type: String, enum: ['pending', 'completed', 'expired'], default: 'pending' },
    expiresAt: { type: Date, required: true },
    lastSentAt: { type: Date },
  },
  { timestamps: true },
);

export const SalonInvite = model<ISalonInvite>('SalonInvite', salonInviteSchema);
