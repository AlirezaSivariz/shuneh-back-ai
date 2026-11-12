import { Schema, model, Document, Types } from 'mongoose';

/**
 * Image-based advertising campaigns managed by Shuneh admins and surfaced as a
 * centered modal on the public website.
 *
 * Display frequency is enforced per viewer through `AdView` rows (one row per
 * advertisement + viewer), while the totals on this document power the admin
 * analytics (impressions / clicks / CTR).
 */
export type AdAudience = 'all' | 'customers' | 'specialists';
export const AD_AUDIENCES: AdAudience[] = ['all', 'customers', 'specialists'];

export interface IAdvertisement extends Document {
  _id: Types.ObjectId;
  title: string | null;
  description: string | null;
  /** Storage key; resolve to a URL with `storageProvider.getUrl`. */
  image: string;
  /** Where the image/CTA navigates (http(s) URL or an internal "/path"). */
  destinationUrl: string;
  ctaText: string;
  audience: AdAudience;
  /** Schedule window (null = unbounded). Stored as Iran start/end of day. */
  startsAt: Date | null;
  endsAt: Date | null;
  isActive: boolean;
  /** Minimum minutes between two displays of this campaign for one viewer. */
  displayIntervalMinutes: number;
  /** Per-viewer cap (0 = unlimited). */
  maxImpressionsPerUser: number;
  /** Campaign-wide cap (0 = unlimited). */
  maxImpressionsTotal: number;
  impressions: number;
  clicks: number;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const advertisementSchema = new Schema<IAdvertisement>(
  {
    title: { type: String, trim: true, default: null },
    description: { type: String, trim: true, default: null },
    image: { type: String, required: true },
    destinationUrl: { type: String, required: true, trim: true },
    ctaText: { type: String, trim: true, default: 'مشاهده' },
    audience: { type: String, enum: AD_AUDIENCES, default: 'all', index: true },
    startsAt: { type: Date, default: null },
    endsAt: { type: Date, default: null },
    isActive: { type: Boolean, default: true, index: true },
    displayIntervalMinutes: { type: Number, default: 60, min: 1 },
    maxImpressionsPerUser: { type: Number, default: 0, min: 0 },
    maxImpressionsTotal: { type: Number, default: 0, min: 0 },
    impressions: { type: Number, default: 0, min: 0 },
    clicks: { type: Number, default: 0, min: 0 },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// Candidate lookup for the public "next ad" query.
advertisementSchema.index({ isActive: 1, startsAt: 1, endsAt: 1 });
advertisementSchema.index({ createdAt: -1 });

export const Advertisement = model<IAdvertisement>('Advertisement', advertisementSchema);
