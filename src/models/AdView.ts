import { Schema, model, Document, Types } from 'mongoose';

/**
 * Per-viewer display state for one advertisement.
 *
 * A single row exists per (advertisement, viewerKey). `lastShownAt` and
 * `impressions` enforce the configured interval and per-user cap; the unique
 * index makes the claim atomic even when several tabs request an ad at once.
 * `viewerKey` is `user:<id>` for authenticated users and `guest:<uuid>` (or an
 * IP fallback) for anonymous visitors.
 */
export interface IAdView extends Document {
  _id: Types.ObjectId;
  advertisement: Types.ObjectId;
  viewerKey: string;
  userId: Types.ObjectId | null;
  impressions: number;
  lastShownAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

const adViewSchema = new Schema<IAdView>(
  {
    advertisement: { type: Schema.Types.ObjectId, ref: 'Advertisement', required: true },
    viewerKey: { type: String, required: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    impressions: { type: Number, default: 0, min: 0 },
    lastShownAt: { type: Date, required: true },
  },
  { timestamps: true },
);

adViewSchema.index({ advertisement: 1, viewerKey: 1 }, { unique: true });
adViewSchema.index({ viewerKey: 1, lastShownAt: -1 });
adViewSchema.index({ advertisement: 1 });

export const AdView = model<IAdView>('AdView', adViewSchema);
