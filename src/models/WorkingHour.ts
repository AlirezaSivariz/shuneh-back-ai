import { Schema, model, Document, Types } from 'mongoose';

/**
 * A stylist's availability slot. salonId is null for freelance hours.
 */
export interface IWorkingHour extends Document {
  stylistId: Types.ObjectId;
  salonId: Types.ObjectId | null;
  dayOfWeek: number; // 0..6
  start: string; // HH:mm
  end: string; // HH:mm
  createdAt: Date;
  updatedAt: Date;
}

const workingHourSchema = new Schema<IWorkingHour>(
  {
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    salonId: { type: Schema.Types.ObjectId, ref: 'Salon', default: null },
    dayOfWeek: { type: Number, required: true, min: 0, max: 6 },
    start: { type: String, required: true },
    end: { type: String, required: true },
  },
  { timestamps: true },
);

workingHourSchema.index({ stylistId: 1, dayOfWeek: 1 });

export const WorkingHour = model<IWorkingHour>('WorkingHour', workingHourSchema);
