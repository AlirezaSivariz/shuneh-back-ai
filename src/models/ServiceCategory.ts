import { Schema, model, Document } from 'mongoose';

export interface IServiceCategory extends Document {
  name: string;
  slug: string;
  description?: string;
  isDefault: boolean;
  order: number;
  createdAt: Date;
  updatedAt: Date;
}

const serviceCategorySchema = new Schema<IServiceCategory>(
  {
    name: { type: String, required: true, trim: true },
    slug: { type: String, required: true, unique: true, index: true, trim: true },
    description: { type: String },
    isDefault: { type: Boolean, default: false },
    order: { type: Number, default: 0 },
  },
  { timestamps: true },
);

export const ServiceCategory = model<IServiceCategory>('ServiceCategory', serviceCategorySchema);
