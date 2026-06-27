import { Schema, model, Document, Types } from 'mongoose';

export type BlogStatus = 'draft' | 'published';

export interface IBlogPost extends Document {
  title: string;
  /** Unique, URL-friendly identifier (Persian or latin). */
  slug: string;
  excerpt: string;
  /** Full body (HTML/markdown produced by the admin editor). */
  content: string;
  /** Storage key of the cover image (resolve to a URL via storageProvider). */
  coverImage: string | null;
  status: BlogStatus;
  author: Types.ObjectId | null;
  publishedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

const blogPostSchema = new Schema<IBlogPost>(
  {
    title: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true },
    excerpt: { type: String, default: '' },
    content: { type: String, default: '' },
    coverImage: { type: String, default: null },
    status: { type: String, enum: ['draft', 'published'], default: 'draft', index: true },
    author: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    // Set the first time a post transitions to 'published'.
    publishedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

// Published feed is sorted by publish recency.
blogPostSchema.index({ status: 1, publishedAt: -1 });

export const BlogPost = model<IBlogPost>('BlogPost', blogPostSchema);
