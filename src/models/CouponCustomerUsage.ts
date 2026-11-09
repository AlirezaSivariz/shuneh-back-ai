import { Schema, model, Document, Types } from 'mongoose';

/**
 * Per-customer redemption counter for a platform coupon. Kept as a separate
 * document so the per-customer limit can be enforced atomically (guarded
 * `$inc`) without loading every redemption.
 */
export interface ICouponCustomerUsage extends Document {
  _id: Types.ObjectId;
  couponId: Types.ObjectId;
  customerId: Types.ObjectId;
  usedCount: number;
  createdAt: Date;
  updatedAt: Date;
}

const couponCustomerUsageSchema = new Schema<ICouponCustomerUsage>(
  {
    couponId: { type: Schema.Types.ObjectId, ref: 'Coupon', required: true, index: true },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    usedCount: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

couponCustomerUsageSchema.index({ couponId: 1, customerId: 1 }, { unique: true });

export const CouponCustomerUsage = model<ICouponCustomerUsage>(
  'CouponCustomerUsage',
  couponCustomerUsageSchema,
);
