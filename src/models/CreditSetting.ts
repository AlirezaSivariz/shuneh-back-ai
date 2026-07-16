import { Schema, model, Document, Types } from 'mongoose';

export interface ICreditSetting extends Document {
  _id: Types.ObjectId;
  completedReservationCredit: number;
  fiveStarReviewCredit: number;
  consecutiveCancelPenalty: number;
  consecutiveCancelThreshold: number;
  silverCreditPrice: number;
  goldCreditPrice: number;
  isEnabled: boolean;
  updatedBy: Types.ObjectId | null;
  updatedAt: Date;
}

const creditSettingSchema = new Schema<ICreditSetting>(
  {
    completedReservationCredit: { type: Number, default: 25, min: 0 },
    fiveStarReviewCredit: { type: Number, default: 15, min: 0 },
    consecutiveCancelPenalty: { type: Number, default: 25, min: 0 },
    consecutiveCancelThreshold: { type: Number, default: 3, min: 1 },
    silverCreditPrice: { type: Number, default: 400, min: 1 },
    goldCreditPrice: { type: Number, default: 700, min: 1 },
    isEnabled: { type: Boolean, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: { createdAt: false, updatedAt: true } },
);

export const CreditSetting = model<ICreditSetting>('CreditSetting', creditSettingSchema);
