import { Schema, model, Document, Types } from 'mongoose';

/** One like per (community answer, user). Drives `CommunityAnswer.likeCount`. */
export interface ICommunityAnswerLike extends Document {
  answerId: Types.ObjectId; // ref CommunityAnswer
  userId: Types.ObjectId; // ref User
  createdAt: Date;
}

const communityAnswerLikeSchema = new Schema<ICommunityAnswerLike>(
  {
    answerId: {
      type: Schema.Types.ObjectId,
      ref: 'CommunityAnswer',
      required: true,
      index: true,
    },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

communityAnswerLikeSchema.index({ answerId: 1, userId: 1 }, { unique: true });

export const CommunityAnswerLike = model<ICommunityAnswerLike>(
  'CommunityAnswerLike',
  communityAnswerLikeSchema,
);
