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
  /** Identity/quality verification (the "blue tick"). Managed by admins. */
  profileSubmittedAt: Date | null;
  verificationStatus: 'incomplete' | 'pending' | 'verified' | 'rejected';
  isVerified: boolean;
  verifiedAt: Date | null;
  verifiedBy: Types.ObjectId | null;
  rejectionReason: string | null;
  /**
   * National-ID card images — SENSITIVE. Stored as keys in PRIVATE storage
   * (never under the public /uploads static mount). Only the owner and admins
   * may view them, via the protected streaming endpoints. Never serialized to
   * any public output.
   */
  nationalCardFront: string | null;
  nationalCardBack: string | null;
  documentsSubmittedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export type VerificationStatus = IStylistProfile['verificationStatus'];

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
    // Verification (blue tick). Defaults keep existing docs valid.
    profileSubmittedAt: { type: Date, default: null },
    verificationStatus: {
      type: String,
      enum: ['incomplete', 'pending', 'verified', 'rejected'],
      default: 'incomplete',
      index: true,
    },
    isVerified: { type: Boolean, default: false },
    verifiedAt: { type: Date, default: null },
    verifiedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    rejectionReason: { type: String, default: null },
    // Sensitive ID documents (PRIVATE storage keys; never publicly served).
    nationalCardFront: { type: String, default: null },
    nationalCardBack: { type: String, default: null },
    documentsSubmittedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const StylistProfile = model<IStylistProfile>('StylistProfile', stylistProfileSchema);
