import { Schema, model, Document, Types } from 'mongoose';

export interface IRefreshToken extends Document {
  jti: string; // unique token id, embedded in the JWT
  userId: Types.ObjectId;
  expiresAt: Date;
  revoked: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const refreshTokenSchema = new Schema<IRefreshToken>(
  {
    jti: { type: String, required: true, unique: true, index: true },
    userId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    expiresAt: { type: Date, required: true },
    revoked: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// Auto-remove tokens once they expire.
refreshTokenSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const RefreshToken = model<IRefreshToken>('RefreshToken', refreshTokenSchema);
