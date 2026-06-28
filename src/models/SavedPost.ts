import { Schema, model, Document, Types } from 'mongoose';

/**
 * A user's saved/bookmarked post. One row per (user, post). Also the raw signal
 * for the future "explore" recommendations — keep it clean and analyzable.
 */
export interface ISavedPost extends Document {
  userId: Types.ObjectId;
  postId: Types.ObjectId;
  createdAt: Date;
}

const savedPostSchema = new Schema<ISavedPost>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

savedPostSchema.index({ userId: 1, postId: 1 }, { unique: true });
// A user's saved list, newest first.
savedPostSchema.index({ userId: 1, createdAt: -1 });

export const SavedPost = model<ISavedPost>('SavedPost', savedPostSchema);
