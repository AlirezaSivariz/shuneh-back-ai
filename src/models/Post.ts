import { Schema, model, Document, Types } from 'mongoose';

export type PostStatus = 'active' | 'removed';
/**
 * Post kind. `normal` = one or more photos (`images`); `before_after` = a
 * before/after pair (`beforeImage`/`afterImage`). Kept open for future kinds
 * (video, story, …) WITHOUT a schema migration.
 */
export type PostType = 'normal' | 'before_after';

export interface IPost extends Document {
  authorId: Types.ObjectId; // ref User (must be a gold-plan stylist at create time)
  type: PostType;
  caption: string;
  images: string[]; // storage keys — for `normal` posts
  beforeImage: string | null; // storage key — for `before_after`
  afterImage: string | null; // storage key — for `before_after`
  /** Optional service this post showcases → pre-selected in the booking flow. */
  relatedServiceId: Types.ObjectId | null;
  hashtags: string[]; // normalized (lowercase, no '#') — extracted from the caption
  likeCount: number;
  commentCount: number;
  status: PostStatus;
  removedReason: string | null; // set when an admin removes it
  createdAt: Date;
  updatedAt: Date;
}

const postSchema = new Schema<IPost>(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    type: { type: String, enum: ['normal', 'before_after'], default: 'normal' },
    caption: { type: String, default: '', maxlength: 2200 },
    images: { type: [String], default: [] },
    beforeImage: { type: String, default: null },
    afterImage: { type: String, default: null },
    relatedServiceId: { type: Schema.Types.ObjectId, ref: 'Service', default: null },
    hashtags: { type: [String], default: [] },
    likeCount: { type: Number, default: 0, min: 0 },
    commentCount: { type: Number, default: 0, min: 0 },
    status: { type: String, enum: ['active', 'removed'], default: 'active', index: true },
    removedReason: { type: String, default: null },
  },
  { timestamps: true },
);

// Feed: active posts, newest first.
postSchema.index({ status: 1, createdAt: -1 });
// Hashtag page: active posts of a tag, newest first.
postSchema.index({ hashtags: 1, status: 1, createdAt: -1 });

export const Post = model<IPost>('Post', postSchema);
