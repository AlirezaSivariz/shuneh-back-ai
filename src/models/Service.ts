import { Schema, model, Document, Types } from 'mongoose';

export interface IService extends Document {
  categoryId: Types.ObjectId;
  name: string;
  durationMin: number; // minutes
  description?: string;
  defaultPrice: number;
  isDefault: boolean;
  /** A stylist-private service: never shown in the public catalogue. */
  isCustom: boolean;
  /** The stylist who owns this custom service (null for public services). */
  ownerStylistId: Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const serviceSchema = new Schema<IService>(
  {
    categoryId: {
      type: Schema.Types.ObjectId,
      ref: 'ServiceCategory',
      required: true,
      index: true,
    },
    name: { type: String, required: true, trim: true },
    durationMin: { type: Number, required: true, min: 1 },
    description: { type: String },
    defaultPrice: { type: Number, required: true, min: 0 },
    isDefault: { type: Boolean, default: false },
    isCustom: { type: Boolean, default: false, index: true },
    ownerStylistId: { type: Schema.Types.ObjectId, ref: 'User', default: null, index: true },
  },
  { timestamps: true },
);

export const Service = model<IService>('Service', serviceSchema);
