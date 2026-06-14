import { Schema, model, Document, Types } from 'mongoose';

export type Role = 'owner' | 'stylist' | 'customer' | 'admin';
export const ROLES: Role[] = ['owner', 'stylist', 'customer', 'admin'];

export interface IUser extends Document {
  _id: Types.ObjectId;
  phone: string;
  roles: Role[];
  /** When false the account is disabled (cannot authenticate). Admin-managed. */
  isActive: boolean;
  firstName?: string;
  lastName?: string;
  nationalCode?: string;
  birthDate?: Date;
  profilePhoto?: string; // storage key
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
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    nationalCode: { type: String, trim: true },
    birthDate: { type: Date },
    profilePhoto: { type: String },
  },
  { timestamps: true },
);

export const User = model<IUser>('User', userSchema);
