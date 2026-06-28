import { Schema, model, Document, Types } from 'mongoose';

export type CommentStatus = 'active' | 'removed';

export interface IPostComment extends Document {
  postId: Types.ObjectId;
  authorId: Types.ObjectId; // any authenticated user
  text: string;
  status: CommentStatus;
  removedReason: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const postCommentSchema = new Schema<IPostComment>(
  {
    postId: { type: Schema.Types.ObjectId, ref: 'Post', required: true, index: true },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    text: { type: String, required: true, trim: true, maxlength: 1000 },
    status: { type: String, enum: ['active', 'removed'], default: 'active' },
    removedReason: { type: String, default: null },
  },
  { timestamps: true },
);

// A post's active comments, oldest first.
postCommentSchema.index({ postId: 1, status: 1, createdAt: 1 });

export const PostComment = model<IPostComment>('PostComment', postCommentSchema);
