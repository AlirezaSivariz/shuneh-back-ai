import { Schema, model, Document, Types } from 'mongoose';

/** One like per (community question, user). Drives `CommunityQuestion.likeCount`. */
export interface ICommunityQuestionLike extends Document {
  questionId: Types.ObjectId; // ref CommunityQuestion
  userId: Types.ObjectId; // ref User
  createdAt: Date;
}

const communityQuestionLikeSchema = new Schema<ICommunityQuestionLike>(
  {
    questionId: {
      type: Schema.Types.ObjectId,
      ref: 'CommunityQuestion',
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

communityQuestionLikeSchema.index({ questionId: 1, userId: 1 }, { unique: true });

export const CommunityQuestionLike = model<ICommunityQuestionLike>(
  'CommunityQuestionLike',
  communityQuestionLikeSchema,
);
