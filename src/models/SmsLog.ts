import { Schema, model, Document, Types } from 'mongoose';

/**
 * Lightweight delivery log for NOTIFICATION SMS (not OTP). Stores only a MASKED
 * recipient (never the full number), the event type, and the gateway outcome —
 * enough for support to debug delivery (e.g. an operator filtering link texts)
 * without keeping PII or message bodies.
 */
export interface ISmsLog extends Document {
  _id: Types.ObjectId;
  /** Masked recipient, e.g. 0912***6789. */
  recipientMasked: string;
  /** Business event, e.g. 'reservation_created', 'salon_invite'. */
  event: string;
  provider: 'limosms' | 'stub';
  success: boolean;
  /** Gateway message id (when delivered) — for later status lookups. */
  messageId?: string | null;
  /** Gateway error / reason when success is false. */
  error?: string | null;
  createdAt: Date;
  updatedAt: Date;
}

const smsLogSchema = new Schema<ISmsLog>(
  {
    recipientMasked: { type: String, required: true },
    event: { type: String, required: true, index: true },
    provider: { type: String, enum: ['limosms', 'stub'], required: true },
    success: { type: Boolean, required: true, index: true },
    messageId: { type: String, default: null },
    error: { type: String, default: null },
  },
  { timestamps: true },
);

smsLogSchema.index({ createdAt: -1 });

export const SmsLog = model<ISmsLog>('SmsLog', smsLogSchema);
