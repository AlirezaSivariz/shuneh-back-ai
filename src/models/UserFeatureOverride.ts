import { Schema, model, Document, Types } from 'mongoose';

export const FEATURE_KEYS = [
  'smart_calendar',
  'sms_reminder',
  'advanced_reports',
  'waiting_list',
  'priority_support',
] as const;

export type FeatureKey = (typeof FEATURE_KEYS)[number];

export interface IUserFeatureOverride extends Document {
  _id: Types.ObjectId;
  userId: Types.ObjectId;
  featureKey: FeatureKey;
  enabled: boolean;
  updatedBy?: Types.ObjectId;
  createdAt: Date;
  updatedAt: Date;
}

const userFeatureOverrideSchema = new Schema<IUserFeatureOverride>(
  {
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true },
    featureKey: { type: String, enum: FEATURE_KEYS, required: true },
    enabled: { type: Boolean, required: true, default: true },
    updatedBy: { type: Schema.Types.ObjectId, ref: 'User' },
  },
  { timestamps: true },
);

userFeatureOverrideSchema.index({ userId: 1, featureKey: 1 }, { unique: true });

export const UserFeatureOverride = model<IUserFeatureOverride>('UserFeatureOverride', userFeatureOverrideSchema);
