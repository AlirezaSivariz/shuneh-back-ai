import { Schema, model, Document, Types } from 'mongoose';
import { GeoPoint } from '../utils/geo';

export type SalonStatus = 'active' | 'pending';

/** Who the salon serves: women-only or men-only. */
export type ServiceGender = 'women' | 'men';
export const SERVICE_GENDERS: ServiceGender[] = ['women', 'men'];

/**
 * Whether a salon matches a gender filter (exact match). No filter → always
 * matches. A salon with no gender set (legacy / not-yet-chosen) matches no
 * filter, so it only surfaces in unfiltered results until its owner picks one.
 */
export function salonMatchesGender(
  salonGender: ServiceGender | undefined | null,
  filter?: ServiceGender,
): boolean {
  if (!filter) return true;
  return salonGender === filter;
}

/** Mongo query fragment for a gender filter (exact match). */
export function genderQuery(filter?: ServiceGender): unknown | undefined {
  if (!filter) return undefined;
  return filter;
}

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
  /** Iran province name (from the shared geo dataset). Nullable for legacy docs. */
  province?: string | null;
  /** City name within `province` (from the shared geo dataset). Nullable. */
  city?: string | null;
  location?: GeoPoint;
  ownerId: Types.ObjectId | null;
  status: SalonStatus;
  serviceGender?: ServiceGender;
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
    // Province/city for filtering & display. Default null keeps legacy docs valid.
    province: { type: String, default: null, index: true },
    city: { type: String, default: null, index: true },
    location: { type: geoPointSchema },
    ownerId: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    status: { type: String, enum: ['active', 'pending'], default: 'active' },
    // women|men only (no default). Legacy salons may have it unset until the
    // owner edits — the startup migration unsets the removed 'unisex' value so
    // those docs stay valid against this enum.
    serviceGender: { type: String, enum: SERVICE_GENDERS, index: true },
    openingHours: { type: [openingHoursSchema], default: [] },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', required: true },
  },
  { timestamps: true },
);

// Geospatial index for "salons near me" search.
salonSchema.index({ location: '2dsphere' });

export const Salon = model<ISalon>('Salon', salonSchema);
