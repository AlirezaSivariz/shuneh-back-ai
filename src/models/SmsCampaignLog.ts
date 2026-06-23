import { Schema, model, Document, Types } from 'mongoose';

/**
 * One row per discount-code SMS a stylist sent (or attempted) via the campaign
 * feature. Powers the anti-spam limits: per-stylist daily count and "same code
 * to the same number within a window" dedupe. The recipient number is stored
 * HASHED (sha256) — never in clear — so dedupe works without keeping the raw
 * subscriber number; `recipientMasked` (0912***6789) is kept for display only.
 * Actual gateway delivery is recorded separately in SmsLog.
 */
export type SmsCampaignStatus = 'queued' | 'failed';

export interface ISmsCampaignLog extends Document {
  _id: Types.ObjectId;
  stylistId: Types.ObjectId;
  discountCodeId: Types.ObjectId;
  /** sha256 of the normalized (09xxxxxxxxx) phone — for dedupe, not display. */
  phoneHash: string;
  recipientMasked: string;
  code: string;
  status: SmsCampaignStatus;
  createdAt: Date;
  updatedAt: Date;
}

const smsCampaignLogSchema = new Schema<ISmsCampaignLog>(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    discountCodeId: { type: Schema.Types.ObjectId, ref: 'DiscountCode', required: true },
    phoneHash: { type: String, required: true },
    recipientMasked: { type: String, required: true },
    code: { type: String, required: true },
    status: { type: String, enum: ['queued', 'failed'], default: 'queued' },
  },
  { timestamps: true },
);

// Daily-quota lookups + same-code/same-number dedupe within a window.
smsCampaignLogSchema.index({ stylistId: 1, createdAt: -1 });
smsCampaignLogSchema.index({ stylistId: 1, discountCodeId: 1, phoneHash: 1, createdAt: -1 });

export const SmsCampaignLog = model<ISmsCampaignLog>('SmsCampaignLog', smsCampaignLogSchema);
