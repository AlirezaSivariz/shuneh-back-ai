import { Schema, model, Document, Types } from 'mongoose';

/** One like per (post, user). Toggled by the like endpoint; drives Post.likeCount. */
export interface IPostLike extends Document {
  postId: Types.ObjectId;
  userId: Types.ObjectId;
  createdAt: Date;
}

const postLikeSchema = new Schema<IPostLike>(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

postLikeSchema.index({ postId: 1, userId: 1 }, { unique: true });

export const PostLike = model<IPostLike>('PostLike', postLikeSchema);
