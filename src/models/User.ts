import { Schema, model, Document, Types } from 'mongoose';

export type Role = 'owner' | 'stylist' | 'customer';
export const ROLES: Role[] = ['owner', 'stylist', 'customer'];

export interface IUser extends Document {
  _id: Types.ObjectId;
  phone: string;
  roles: Role[];
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
    firstName: { type: String, trim: true },
    lastName: { type: String, trim: true },
    nationalCode: { type: String, trim: true },
    birthDate: { type: Date },
    profilePhoto: { type: String },
  },
  { timestamps: true },
);

export const User = model<IUser>('User', userSchema);
