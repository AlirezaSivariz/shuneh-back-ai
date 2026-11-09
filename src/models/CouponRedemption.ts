import { Schema, model, Document, Types } from 'mongoose';
import type { CouponCampaignType } from './Coupon';
import type { DiscountType } from './DiscountCode';

/**
 * Immutable record of one platform-coupon redemption. Retained after the coupon
 * itself is deleted so campaign costs remain auditable.
 */
export interface ICouponRedemption extends Document {
  _id: Types.ObjectId;
  couponId: Types.ObjectId;
  code: string;
  name: string | null;
  campaign: CouponCampaignType;
  type: DiscountType;
  value: number;
  customerId: Types.ObjectId;
  stylistId: Types.ObjectId;
  reservationId: Types.ObjectId;
  /** Gross booking amount (sum of items × persons). */
  originalPrice: number;
  /** Amount after any stylist discount, before the platform coupon. */
  priceBeforeCoupon: number;
  discountAmount: number;
  finalPrice: number;
  /** Amount funded by Shuneh (equal to the coupon discount). */
  platformFundedAmount: number;
  depositAmount: number;
  createdAt: Date;
}

const couponRedemptionSchema = new Schema<ICouponRedemption>(
  {
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    code: { type: String, required: true },
    name: { type: String, default: null },
    campaign: { type: String, required: true },
    type: { type: String, enum: ['percentage', 'fixed'], required: true },
    value: { type: Number, required: true, min: 0 },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    reservationId: { type: Schema.Types.ObjectId, ref: 'Reservation', required: true },
    originalPrice: { type: Number, required: true, min: 0 },
    priceBeforeCoupon: { type: Number, required: true, min: 0 },
    discountAmount: { type: Number, required: true, min: 0 },
    finalPrice: { type: Number, required: true, min: 0 },
    platformFundedAmount: { type: Number, required: true, min: 0 },
    depositAmount: { type: Number, required: true, min: 0 },
  },
  { timestamps: { createdAt: true, updatedAt: false } },
);

// One redemption per reservation (idempotent rollback/redeem).
couponRedemptionSchema.index({ reservationId: 1 }, { unique: true });
couponRedemptionSchema.index({ couponId: 1, createdAt: -1 });

export const CouponRedemption = model<ICouponRedemption>(
  'CouponRedemption',
  couponRedemptionSchema,
);
