import { Schema, model, Document, Types } from 'mongoose';

export type CommunityAnswerStatus = 'active' | 'removed';

export interface ICommunityAnswer extends Document {
  questionId: Types.ObjectId; // ref CommunityQuestion
  authorId: Types.ObjectId; // ref User — any authenticated user.
  content: string;
  likeCount: number;
  /** «پاسخ برگزیده» — chosen/marked answer. Independent of author verification. */
  isVerifiedAnswer: boolean;
  status: CommunityAnswerStatus;
  removedReason: string | null;
  /**
   * Stable key for idempotent seeding (`q1-a1`, …). Null for user-created
   * answers. Seeding only ever INSERTS — never overwrites live data.
   */
  seedKey?: string;
  createdAt: Date;
  updatedAt: Date;
}

const communityAnswerSchema = new Schema<ICommunityAnswer>(
  {
    questionId: {
      type: Schema.Types.ObjectId,
      ref: 'CommunityQuestion',
      required: true,
      index: true,
    },
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    content: { type: String, required: true, trim: true, maxlength: 2000 },
    likeCount: { type: Number, default: 0, min: 0 },
    isVerifiedAnswer: { type: Boolean, default: false },
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

// A question's active answers, oldest first.
communityAnswerSchema.index({ questionId: 1, status: 1, createdAt: 1 });

export const CommunityAnswer = model<ICommunityAnswer>(
  'CommunityAnswer',
  communityAnswerSchema,
);
