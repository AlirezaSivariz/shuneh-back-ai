import { Schema, model, Document, Types } from 'mongoose';

export interface ICreditWallet extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  balance: number;
  totalEarned: number;
  totalSpent: number;
  version: number;
  createdAt: Date;
  updatedAt: Date;
}

const creditWalletSchema = new Schema<ICreditWallet>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true },
    balance: { type: Number, required: true, default: 0 },
    totalEarned: { type: Number, required: true, default: 0, min: 0 },
    totalSpent: { type: Number, required: true, default: 0, min: 0 },
    version: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const CreditWallet = model<ICreditWallet>('CreditWallet', creditWalletSchema);
