import { Schema, model, Document, Types } from 'mongoose';

export type StoryStatus = 'active' | 'removed';

/** Ephemeral 24h photo story (gold-plan stylists). Expiry is enforced BOTH at
 * read time (`expiresAt > now`) and by a cleanup job that deletes the record +
 * its image from storage. Phase: photo only. */
export interface IStory extends Document {
  authorId: Types.ObjectId; // ref User (gold stylist at create time)
  image: string; // storage key (resolve via storageProvider)
  caption: string;
  status: StoryStatus;
  removedReason: string | null;
  createdAt: Date;
  expiresAt: Date; // createdAt + 24h
}

const storySchema = new Schema<IStory>(
  {
    authorId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    image: { type: String, required: true },
    caption: { type: String, default: '', maxlength: 500 },
    status: { type: String, enum: ['active', 'removed'], default: 'active', index: true },
    removedReason: { type: String, default: null },
    expiresAt: { type: Date, required: true },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// Active, non-expired stories per author (story-row + author viewer).
storySchema.index({ authorId: 1, status: 1, expiresAt: 1 });
// Cleanup job scan.
storySchema.index({ expiresAt: 1 });

export const Story = model<IStory>('Story', storySchema);
