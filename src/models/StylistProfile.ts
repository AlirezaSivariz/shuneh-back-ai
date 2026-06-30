import { Schema, model, Document, Types } from 'mongoose';
import { GeoPoint } from '../utils/geo';
import {
  ICancellationPolicy,
  cancellationPolicySchema,
} from './cancellationPolicy';

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

/**
 * Subscription plan tier. `free` → booking + analytics only; `silver` → adds the
 * SMS discount-campaign panel; `gold` → silver + reserved for future perks.
 * There is no payment gateway, so only an admin changes this.
 */
export type PlanTier = 'free' | 'silver' | 'gold';

export const PLAN_TIERS: PlanTier[] = ['free', 'silver', 'gold'];

/** Silver and above unlock the SMS discount-campaign feature. */
export function planAllowsSmsCampaign(tier: PlanTier): boolean {
  return tier === 'silver' || tier === 'gold';
}

export interface IFreelanceInfo {
  address?: string;
  location?: GeoPoint;
}

/** A stylist's per-service cancellation policy override (gold plan only). */
export interface IServiceCancellationPolicy {
  serviceId: Types.ObjectId;
  policy: ICancellationPolicy;
}

/** Bank payout details — SENSITIVE. Owner + admin only; masked elsewhere. */
export interface IPayoutInfo {
  shebaNumber?: string | null;
  cardNumber?: string | null;
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
  /**
   * Paid-plan gate for the "send discount code by SMS" campaign feature (a
   * «نقره‌ای»/silver capability). Default false. There is NO payment gateway yet,
   * so a stylist cannot buy it — only an admin flips this. When billing exists,
   * a successful plan purchase will set this true (see admin sms-campaign + TODO).
   */
  smsCampaignEnabled: boolean;
  /**
   * Subscription plan tier (source of truth for paid features). `smsCampaignEnabled`
   * is kept in sync with this (silver+ → true) so existing gates keep working.
   */
  planTier: PlanTier;
  /**
   * Raised when a working-hours / salon opening-hours change left one or more
   * FUTURE reservations falling outside the stylist's current effective hours.
   * Existing reservations are never auto-cancelled (the commitment stands); this
   * flag tells the panel to surface a banner so the stylist reconciles them.
   * Cleared automatically once no future reservation is out-of-hours.
   */
  needsHoursUpdate: boolean;
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
  /** When the sensitive ID images were deleted after a verification decision. */
  documentsDeletedAt: Date | null;
  /**
   * The stylist's OWN general cancellation policy (silver+). Null → the stylist
   * follows the salon's policy (or the system default). See `src/modules/policy`.
   */
  cancellationPolicy?: ICancellationPolicy | null;
  /** Per-service policy overrides (gold only) — take precedence over the general one. */
  servicePolicies?: IServiceCancellationPolicy[];
  /** Bank payout details (SHEBA + card) — sensitive; owner + admin only. */
  payout?: IPayoutInfo | null;
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
    // Paid «نقره‌ای» plan gate for SMS discount campaigns. Default false; only an
    // admin flips it today (no billing yet). Existing docs default to false.
    smsCampaignEnabled: { type: Boolean, default: false },
    // Subscription plan tier; source of truth for paid features. Admin-managed
    // only (no billing yet). Defaults keep existing docs valid.
    planTier: { type: String, enum: PLAN_TIERS, default: 'free', index: true },
    // Raised when an hours change orphaned future reservations (default keeps
    // existing docs valid).
    needsHoursUpdate: { type: Boolean, default: false },
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
    documentsDeletedAt: { type: Date, default: null },
    // Cancellation policy: own general policy (silver+) + per-service (gold).
    // Null/empty → follow the salon policy (or the system default).
    cancellationPolicy: { type: cancellationPolicySchema, default: null },
    servicePolicies: {
      type: [
        new Schema<IServiceCancellationPolicy>(
          {
            serviceId: { type: Schema.Types.ObjectId, ref: 'Service', required: true },
            policy: { type: cancellationPolicySchema, required: true },
          },
          { _id: false },
        ),
      ],
      default: [],
    },
    // Sensitive bank payout details (SHEBA + card). Owner + admin only; never
    // serialized into public output, masked in non-essential views.
    payout: {
      type: new Schema<IPayoutInfo>(
        {
          shebaNumber: { type: String, default: null },
          cardNumber: { type: String, default: null },
        },
        { _id: false },
      ),
      default: null,
    },
  },
  { timestamps: true },
);

export const StylistProfile = model<IStylistProfile>('StylistProfile', stylistProfileSchema);
