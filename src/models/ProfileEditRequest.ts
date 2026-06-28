import { Schema, model, Document, Types } from 'mongoose';

export type ProfileEditStatus = 'pending' | 'approved' | 'rejected';

/**
 * A user-requested change to their displayed name. Edits are NOT applied
 * immediately — an admin reviews and approves/rejects, so a (possibly verified)
 * profile can't silently change identity. At most one `pending` request per user
 * (enforced in the service by replacing any open one).
 */
export interface IProfileEditRequest extends Document {
  userId: Types.ObjectId;
  firstName: string;
  lastName: string;
  status: ProfileEditStatus;
  reviewedBy: Types.ObjectId | null;
  rejectionReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const profileEditRequestSchema = new Schema<IProfileEditRequest>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    firstName: { type: String, required: true, trim: true },
    lastName: { type: String, required: true, trim: true },
    status: { type: String, enum: ['pending', 'approved', 'rejected'], default: 'pending', index: true },
    reviewedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: null },
  },
  { timestamps: true },
);

// Admin queue: oldest pending first.
profileEditRequestSchema.index({ status: 1, createdAt: 1 });

export const ProfileEditRequest = model<IProfileEditRequest>(
  'ProfileEditRequest',
  profileEditRequestSchema,
);
