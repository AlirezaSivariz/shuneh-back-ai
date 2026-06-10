import { Schema, model, Document } from 'mongoose';

export interface IOtp extends Document {
  phone: string;
  code: string;
  expiresAt: Date;
  attempts: number;
  used: boolean;
  createdAt: Date;
  updatedAt: Date;
}

const otpSchema = new Schema<IOtp>(
  {
    phone: { type: String, required: true, index: true },
    code: { type: String, required: true },
    expiresAt: { type: Date, required: true },
    attempts: { type: Number, default: 0 },
    used: { type: Boolean, default: false },
  },
  { timestamps: true },
);

// TTL cleanup: documents are removed shortly after they expire.
otpSchema.index({ expiresAt: 1 }, { expireAfterSeconds: 0 });

export const Otp = model<IOtp>('Otp', otpSchema);
