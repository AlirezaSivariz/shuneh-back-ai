import { Schema, model, Document, Types } from 'mongoose';
import { GeoPoint } from '../utils/geo';

export type SalonStatus = 'active' | 'pending';

export interface IOpeningInterval {
  start: string; // HH:mm
  end: string; // HH:mm
}

export interface IOpeningHours {
  dayOfWeek: number; // 0..6
  intervals: IOpeningInterval[];
}

export interface ISalon extends Document {
  _id: Types.ObjectId;
  name: string;
  description?: string;
  address?: string;
  location?: GeoPoint;
  ownerId: Types.ObjectId | null;
  status: SalonStatus;
  openingHours: IOpeningHours[];
  createdBy: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const geoPointSchema = new Schema<GeoPoint>(
  {
    type: { type: String, enum: ['Point'], default: 'Point' },
    coordinates: { type: [Number], required: true }, // [lng, lat]
  },
  { _id: false },
);

const openingHoursSchema = new Schema<IOpeningHours>(
  {
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    intervals: {
      type: [
        new Schema<IOpeningInterval>(
          { start: { type: String, required: true }, end: { type: String, required: true } },
          { _id: false },
        ),
      ],
      default: [],
    },
  },
  { _id: false },
);

const salonSchema = new Schema<ISalon>(
  {
    name: { type: String, required: true, trim: true, index: true },
    description: { type: String },
    address: { type: String },
    location: { type: geoPointSchema },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['active', 'pending'], default: 'active' },
    openingHours: { type: [openingHoursSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

// Geospatial index for "salons near me" search.
salonSchema.index({ location: '2dsphere' });

export const Salon = model<ISalon>('Salon', salonSchema);
