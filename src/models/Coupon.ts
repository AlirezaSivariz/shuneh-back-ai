import { Schema, model, Document, Types } from 'mongoose';
import type { DiscountType } from './DiscountCode';

/**
 * Platform-funded discount coupons created by Shuneh admins.
 *
 * Unlike the stylist-owned `DiscountCode` (whose discount is absorbed by the
 * stylist), a platform coupon is funded 100% by Shuneh: the customer pays less,
 * while the specialist's earnings are preserved. Redemptions are stored
 * immutably in `CouponRedemption` for campaign accounting.
 */
export type CouponCampaignType =
  | 'first_booking'
  | 'seasonal'
  | 'black_friday'
  | 'retention'
  | 'custom';

export const COUPON_CAMPAIGN_TYPES: CouponCampaignType[] = [
  'first_booking',
  'seasonal',
  'black_friday',
  'retention',
  'custom',
];

export interface ICoupon extends Document {
  _id: Types.ObjectId;
  code: string;
  /** Lower-cased code for case-insensitive global uniqueness/lookup. */
  codeLower: string;
  /** Human-readable title for the admin panel (optional). */
  name: string | null;
  description: string | null;
  campaign: CouponCampaignType;
  type: DiscountType;
  value: number;
  /** Cap for percentage discounts (toman). null = uncapped. */
  maxDiscountAmount: number | null;
  /** Minimum booking amount (after any stylist discount) required. */
  minBookingAmount: number;
  /** Redemption window (checked against "now"). null = unbounded. */
  validFrom: Date | null;
  validUntil: Date | null;
  /** Global redemption cap. null = unlimited. */
  usageLimit: number | null;
  /** Maximum redemptions per customer. null = unlimited. */
  perCustomerLimit: number | null;
  /** Only customers with no previous booking may redeem. */
  newCustomersOnly: boolean;
  /** Restrict to service categories (empty = all categories). */
  categoryIds: Types.ObjectId[];
  /** Restrict to specific specialists (empty = all specialists). */
  stylistIds: Types.ObjectId[];
  usageCount: number;
  isActive: boolean;
  createdBy: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const couponSchema = new Schema<ICoupon>(
  {
    code: { type: String, required: true, trim: true },
    codeLower: { type: String, required: true },
    name: { type: String, default: null, trim: true, maxlength: 120 },
    description: { type: String, default: null, trim: true, maxlength: 500 },
    campaign: {
      type: String,
      enum: COUPON_CAMPAIGN_TYPES,
      required: true,
      default: 'custom',
    },
    type: { type: String, enum: ['percentage', 'fixed'], required: true },
    value: { type: Number, required: true, min: 0 },
    maxDiscountAmount: { type: Number, default: null, min: 0 },
    minBookingAmount: { type: Number, default: 0, min: 0 },
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },
    usageLimit: { type: Number, default: null, min: 1 },
    perCustomerLimit: { type: Number, default: null, min: 1 },
    newCustomersOnly: { type: Boolean, default: false },
    categoryIds: { type: [Schema.Types.ObjectId], ref: 'ServiceCategory', default: [] },
    stylistIds: { type: [Schema.Types.ObjectId], ref: 'User', default: [] },
    usageCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// One code string globally (case-insensitive).
couponSchema.index({ codeLower: 1 }, { unique: true });
couponSchema.index({ isActive: 1, validFrom: 1, validUntil: 1 });

export const Coupon = model<ICoupon>('Coupon', couponSchema);
