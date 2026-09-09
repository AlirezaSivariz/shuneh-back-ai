import { Schema, model, Document, Types } from 'mongoose';

export interface IReferral extends Document {
  _id: Types.ObjectId;
  /** The user who invited someone (gets the reward). */
  referrerId: Types.ObjectId;
  /** The invited user (the referee). Unique — each customer can be referred once. */
  refereeId: Types.ObjectId;
  /** The reward amount snapshotted at claim time (credit units). */
  rewardAmount: number;
  /** The referral code used at claim time (audit/display). */
  referralCode: string;
  status: 'rewarded' | 'rolled_back';
  createdAt: Date;
}

const referralSchema = new Schema<IReferral>(
  {
    referrerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    // Unique: the relationship is established exactly once per referee and the
    // referrer can never be changed later. The unique index is also the
    // concurrency guard for race-prone duplicate claim requests.
    refereeId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    rewardAmount: { type: Number, required: true, default: 0, min: 0 },
    referralCode: { type: String, trim: true, uppercase: true, required: true },
    status: { type: String, enum: ['rewarded', 'rolled_back'], default: 'rewarded' },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// A referrer's invite list (who did they invite?) — sorted newest first.
referralSchema.index({ referrerId: 1, createdAt: -1 });

export const Referral = model<IReferral>('Referral', referralSchema);