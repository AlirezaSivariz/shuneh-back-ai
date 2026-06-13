import { Schema, model, Document, Types } from 'mongoose';
import { GeoPoint } from '../utils/geo';

export type WorkplaceType = 'freelance' | 'salon';

export type OnboardingStep =
  | 'role'
  | 'personal'
  | 'services'
  | 'workplace'
  | 'workingHours'
  | 'media'
  | 'completed';

export const ONBOARDING_STEPS: OnboardingStep[] = [
  'role',
  'personal',
  'services',
  'workplace',
  'workingHours',
  'media',
  'completed',
];

export type StylistStatus = 'draft' | 'active';

export interface IFreelanceInfo {
  address?: string;
  location?: GeoPoint;
}

export interface IStylistProfile extends Document {
  userId: Types.ObjectId;
  workplaceType?: WorkplaceType;
  freelance?: IFreelanceInfo;
  portfolio: string[]; // storage keys
  onboardingStep: OnboardingStep;
  status: StylistStatus;
  /**
   * Whether the stylist currently accepts NEW reservations. Independent of the
   * onboarding `status`: a fully-active stylist can pause bookings without
   * touching existing reservations.
   */
  isAcceptingReservations: boolean;
  /** Aggregate rating, updated incrementally on each new review. */
  ratingAverage: number;
  ratingCount: number;
  /** Promotion (paid placement). Activated manually until billing exists. */
  isPromoted: boolean;
  promotedUntil: Date | null;
  promotionTier?: number | null;
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

const stylistProfileSchema = new Schema<IStylistProfile>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, unique: true, index: true },
    workplaceType: { type: String, enum: ['freelance', 'salon'] },
    freelance: {
      type: new Schema<IFreelanceInfo>(
        {
          address: { type: String },
          location: { type: geoPointSchema },
        },
        { _id: false },
      ),
      default: undefined,
    },
    portfolio: { type: [String], default: [] },
    onboardingStep: { type: String, enum: ONBOARDING_STEPS, default: 'role' },
    status: { type: String, enum: ['draft', 'active'], default: 'draft' },
    isAcceptingReservations: { type: Boolean, default: true },
    // Ratings (defaults keep existing docs valid).
    ratingAverage: { type: Number, default: 0, min: 0, max: 5 },
    ratingCount: { type: Number, default: 0, min: 0 },
    // Promotion (manual until billing is added).
    isPromoted: { type: Boolean, default: false },
    promotedUntil: { type: Date, default: null },
    promotionTier: { type: Number, default: null },
  },
  { timestamps: true },
);

export const StylistProfile = model<IStylistProfile>('StylistProfile', stylistProfileSchema);
