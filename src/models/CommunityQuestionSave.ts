import { Schema, model, Document, Types } from 'mongoose';

/** A user's saved/bookmarked community question. One row per (user, question). */
export interface ICommunityQuestionSave extends Document {
  userId: Types.ObjectId; // ref User
  questionId: Types.ObjectId; // ref CommunityQuestion
  createdAt: Date;
}

const communityQuestionSaveSchema = new Schema<ICommunityQuestionSave>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    questionId: {
      type: Schema.Types.ObjectId,
      ref: 'CommunityQuestion',
      required: true,
      index: true,
    },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

communityQuestionSaveSchema.index({ userId: 1, questionId: 1 }, { unique: true });
// A user's saved questions, newest-saved first.
communityQuestionSaveSchema.index({ userId: 1, createdAt: -1 });

export const CommunityQuestionSave = model<ICommunityQuestionSave>(
  'CommunityQuestionSave',
  communityQuestionSaveSchema,
);
