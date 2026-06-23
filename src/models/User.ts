import { Schema, model, Document, Types } from 'mongoose';

export type Role = 'owner' | 'stylist' | 'customer' | 'admin';
export const ROLES: Role[] = ['owner', 'stylist', 'customer', 'admin'];

/**
 * Roles a user may grant THEMSELVES through onboarding (`POST /onboarding/role`).
 * 'admin' is deliberately excluded — it can ONLY be minted by the admin seed
 * script, never via the normal registration/OTP flow.
 */
export const SELF_ASSIGNABLE_ROLES: Role[] = ['owner', 'stylist', 'customer'];

/**
 * Foreign-national approval lifecycle.
 *  - not_required : Iranian user (has a nationalCode) — no approval gate.
 *  - pending      : foreign user awaiting admin (support) approval — RESTRICTED.
 *  - approved     : foreign user cleared by an admin — full access.
 *  - rejected     : foreign user declined — stays restricted (reason stored).
 */
export type ForeignApprovalStatus = 'not_required' | 'pending' | 'approved' | 'rejected';
export const FOREIGN_APPROVAL_STATUSES: ForeignApprovalStatus[] = [
  'not_required',
  'pending',
  'approved',
  'rejected',
];

export interface IUser extends Document {
  _id: Types.ObjectId;
  phone: string;
  roles: Role[];
  /** When false the account is disabled (cannot authenticate). Admin-managed. */
  isActive: boolean;
  /** Why an admin suspended the account (shown to support; set when isActive=false). */
  suspendedReason?: string | null;
  firstName?: string;
  lastName?: string;
  nationalCode?: string;
  birthDate?: Date;
  profilePhoto?: string; // storage key
  /** True when the user has no Iranian national code (uses foreignId instead). */
  isForeignNational: boolean;
  /** Foreign user's 12-digit assigned id (unique). Null for Iranian users. */
  foreignId?: string | null;
  /** Approval gate for foreign users (see ForeignApprovalStatus). */
  foreignApprovalStatus: ForeignApprovalStatus;
  /** Why a foreign user's approval was rejected (shown back to them). */
  foreignRejectionReason?: string | null;
  /**
   * Wallet balance in **whole Toman** (integer — never fractional, to avoid
   * rounding errors). Only ever changed atomically alongside a WalletTransaction
   * ledger entry (see `wallet.service`). Defaults to 0.
   */
  walletBalance: number;
  createdAt: Date;
  updatedAt: Date;
}

const userSchema = new Schema<IUser>(
  {
    phone: { type: String, required: true, unique: true, index: true, trim: true },
    roles: {
      type: [String],
      enum: ROLES,
      default: [],
    },
    isActive: { type: Boolean, default: true, index: true },
    suspendedReason: { type: String, default: null },
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    nationalCode: { type: String, trim: true },
    birthDate: { type: Date },
    profilePhoto: { type: String },
    isForeignNational: { type: Boolean, default: false },
    foreignId: { type: String, trim: true, default: null },
    foreignApprovalStatus: {
      type: String,
      enum: FOREIGN_APPROVAL_STATUSES,
      default: 'not_required',
      index: true,
    },
    foreignRejectionReason: { type: String, default: null },
    // Wallet balance in whole Toman (integer). Mutated only via wallet.service
    // (atomic with a WalletTransaction). min:0 — balance never goes negative.
    walletBalance: { type: Number, default: 0, min: 0 },
  },
  { timestamps: true },
);

// A national code identifies one account. Partial index so the many users who
// have NOT set a national code yet (field absent) don't collide on null.
userSchema.index(
  { nationalCode: 1 },
  { unique: true, partialFilterExpression: { nationalCode: { $type: 'string' } } },
);

// A foreign id likewise identifies one account (same partial-unique strategy so
// users without a foreignId — most of them — never collide on null).
userSchema.index(
  { foreignId: 1 },
  { unique: true, partialFilterExpression: { foreignId: { $type: 'string' } } },
);

export const User = model<IUser>('User', userSchema);
