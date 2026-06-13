import { Schema, model, Document, Types } from 'mongoose';

export type DiscountType = 'percentage' | 'fixed';
export type DiscountAppliesTo = 'all' | 'services';

export interface IDiscountTimeConstraints {
  /** Allowed appointment weekdays (JS getUTCDay: 0=Sun … 6=Sat). null = any. */
  daysOfWeek: number[] | null;
  /** Appointment start must fall within [startTime, endTime] (HH:mm). */
  startTime: string | null;
  endTime: string | null;
}

/**
 * A discount code a stylist creates for their own bookings. Codes are unique
 * per stylist (case-insensitive via `codeLower`). The discount applies to all
 * of the stylist's services, or to a chosen subset (`appliesTo='services'`).
 */
export interface IDiscountCode extends Document {
  _id: Types.ObjectId;
  stylistId: Types.ObjectId;
  code: string;
  /** Lower-cased code for case-insensitive per-stylist uniqueness/lookup. */
  codeLower: string;
  type: DiscountType;
  value: number;
  /** Cap for percentage discounts (toman). null = uncapped. */
  maxDiscountAmount: number | null;
  appliesTo: DiscountAppliesTo;
  serviceIds: Types.ObjectId[];
  /** Code redemption window (checked against "now"). null = unbounded. */
  validFrom: Date | null;
  validUntil: Date | null;
  /** Constraints on the APPOINTMENT's day/time (not the redemption time). */
  timeConstraints: IDiscountTimeConstraints;
  usageLimit: number | null;
  usedCount: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const timeConstraintsSchema = new Schema<IDiscountTimeConstraints>(
  {
    daysOfWeek: { type: [Number], default: null },
    startTime: { type: String, default: null },
    endTime: { type: String, default: null },
  },
  { _id: false },
);

const discountCodeSchema = new Schema<IDiscountCode>(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    code: { type: String, required: true, trim: true },
    codeLower: { type: String, required: true },
    type: { type: String, enum: ['percentage', 'fixed'], required: true },
    value: { type: Number, required: true, min: 0 },
    maxDiscountAmount: { type: Number, default: null, min: 0 },
    appliesTo: { type: String, enum: ['all', 'services'], default: 'all' },
    serviceIds: { type: [Schema.Types.ObjectId], ref: 'Service', default: [] },
    validFrom: { type: Date, default: null },
    validUntil: { type: Date, default: null },
    timeConstraints: {
      type: timeConstraintsSchema,
      default: () => ({ daysOfWeek: null, startTime: null, endTime: null }),
    },
    usageLimit: { type: Number, default: null, min: 1 },
    usedCount: { type: Number, default: 0, min: 0 },
    isActive: { type: Boolean, default: true },
  },
  { timestamps: true },
);

// One code string per stylist (case-insensitive).
discountCodeSchema.index({ stylistId: 1, codeLower: 1 }, { unique: true });

export const DiscountCode = model<IDiscountCode>('DiscountCode', discountCodeSchema);
