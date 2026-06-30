import { Schema, model, Document, Types } from 'mongoose';

/**
 * A customer/user following a stylist (شونه‌گرام). One row per
 * (followerId, stylistId); unfollow deletes the row. Drives the "following"
 * feed mode + isFollowing/followersCount on posts and stylist profiles.
 */
export interface IFollow extends Document {
  _id: Types.ObjectId;
  followerId: Types.ObjectId;
  stylistId: Types.ObjectId;
  createdAt: Date;
}

const followSchema = new Schema<IFollow>(
  {
    followerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    // Indexed for fast follower-count + "is X followed" lookups.
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One follow per (follower, stylist); also serves the per-follower lookups.
followSchema.index({ followerId: 1, stylistId: 1 }, { unique: true });

export const Follow = model<IFollow>('Follow', followSchema);
