import { Schema, model, Document } from 'mongoose';

export interface IRedirect extends Document {
  fromPath: string;
  toPath: string;
  /** HTTP status code for the redirect. */
  statusCode: 301 | 302;
  /** Set to true by the system when a stylist username/URL changes. */
  isAuto: boolean;
  /** Optional note (e.g. old stylist username). */
  note?: string;
  createdBy?: Schema.Types.ObjectId | null;
  createdAt: Date;
  updatedAt: Date;
}

const redirectSchema = new Schema<IRedirect>(
  {
    fromPath: { type: String, required: true, trim: true, unique: true },
    toPath: { type: String, required: true, trim: true },
    statusCode: { type: Number, enum: [301, 302], default: 301 },
    isAuto: { type: Boolean, default: false, index: true },
    note: { type: String, trim: true, default: '' },
    createdBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
  },
  { timestamps: true },
);

redirectSchema.index({ createdAt: -1 });

export const Redirect = model<IRedirect>('Redirect', redirectSchema);
