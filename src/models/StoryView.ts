import { Schema, model, Document, Types } from 'mongoose';

/** One view per (story, viewer). Drives the seen/unseen ring + the author's
 * viewers list. */
export interface IStoryView extends Document {
  storyId: Types.ObjectId;
  viewerId: Types.ObjectId;
  seenAt: Date;
}

const storyViewSchema = new Schema<IStoryView>(
  {
    storyId: { type: Schema.Types.ObjectId, ref: 'Story', required: true, index: true },
    viewerId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: { createdAt: 'seenAt', updatedAt: false } },
);

storyViewSchema.index({ storyId: 1, viewerId: 1 }, { unique: true });

export const StoryView = model<IStoryView>('StoryView', storyViewSchema);
