import { Schema, model, Document, Types } from 'mongoose';

/**
 * Community «پرسش و پاسخ» categories. These mirror the frontend
 * `CommunityCategory` union — keep them in sync with
 * `web/src/types/community.ts`.
 */
export type CommunityQuestionCategory =
  | 'salon' // سالن زیبایی
  | 'hair-trend' // مدل مو ترند
  | 'nails' // ناخن
  | 'mens' // مو مردانه
  | 'hair-problems' // مشکلات مو
  | 'skin' // پوست و زیبایی
  | 'booking'; // رزرو و خدمات

export const COMMUNITY_QUESTION_CATEGORIES: CommunityQuestionCategory[] = [
  'salon',
  'hair-trend',
  'nails',
  'mens',
  'hair-problems',
  'skin',
  'booking',
];

export type CommunityQuestionStatus = 'active' | 'removed';

export interface ICommunityQuestion extends Document {
  authorId: Types.ObjectId; // ref User — anyone signed-in may ask.
  title: string;
  content: string;
  category: CommunityQuestionCategory;
  viewCount: number;
  likeCount: number;
  answerCount: number;
  status: CommunityQuestionStatus;
  removedReason: string | null;
  /**
   * Stable key for idempotent seeding (`q1`, `q2`, …). Null for user-created
   * questions. Seeding only ever INSERTS (never overwrites), so a seed question
   * that has since gained likes/answers is left untouched on re-boot.
   */
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const communityQuestionSchema = new Schema<ICommunityQuestion>(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    title: { type: String, required: true, trim: true, maxlength: 200 },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    category: {
      type: String,
      enum: COMMUNITY_QUESTION_CATEGORIES,
      required: true,
      index: true,
    },
    viewCount: { type: Number, default: 0, min: 0 },
    likeCount: { type: Number, default: 0, min: 0 },
    answerCount: { type: Number, default: 0, min: 0 },
    status: {
      type: String,
      enum: ['active', 'removed'],
      default: 'active',
      index: true,
    },
    removedReason: { type: String, default: null },
    seedKey: { type: String, unique: true, sparse: true },
  },
  { timestamps: true },
);

// Feed: active questions, newest first.
communityQuestionSchema.index({ status: 1, createdAt: -1 });
// Category filter: active questions of a category, newest first.
communityQuestionSchema.index({ status: 1, category: 1, createdAt: -1 });
// "Popular" sort — pre-computed so the sort is indexable.
communityQuestionSchema.index({ status: 1, likeCount: -1, answerCount: -1 });

export const CommunityQuestion = model<ICommunityQuestion>(
  'CommunityQuestion',
  communityQuestionSchema,
);
