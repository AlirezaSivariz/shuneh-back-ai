import { Schema, model, Document, Types } from 'mongoose';

/**
 * A paid placement (promotion) for a stylist. `categoryId === null` is a GENERAL
 * promotion (boosts the stylist on the landing page and the no-filter search);
 * a set `categoryId` boosts the stylist only when customers filter by that
 * service category. There is no payment gateway yet, so promotions are created
 * by admins — once billing exists, a successful purchase will create the same
 * record (see TODO in admin.service `addPromotion`).
 */
export interface IPromotion extends Document {
  stylistId: Types.ObjectId; // ref User (the stylist)
  categoryId: Types.ObjectId | null; // ref ServiceCategory; null = general
  promotedUntil: Date;
  createdBy: Types.ObjectId | null; // admin who set it
  createdAt: Date;
  updatedAt: Date;
}

const promotionSchema = new Schema<IPromotion>(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    categoryId: { type: Schema.Types.ObjectId, ref: 'ServiceCategory', default: null },
    promotedUntil: { type: Date, required: true },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

// At most one promotion per (stylist, category). A null categoryId is treated
// as a distinct value by the unique index → one general slot + one per category.
promotionSchema.index({ stylistId: 1, categoryId: 1 }, { unique: true });
// Fast "active promotions" scans.
promotionSchema.index({ promotedUntil: 1 });

export const Promotion = model<IPromotion>('Promotion', promotionSchema);
