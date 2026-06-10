import { Schema, model, Document, Types } from 'mongoose';

/**
 * A customer's rating/review of a completed reservation. One review per
 * reservation (enforced by the unique index on reservationId).
 */
export interface IReview extends Document {
  _id: Types.ObjectId;
  reservationId: Types.ObjectId;
  customerId: Types.ObjectId;
  stylistId: Types.ObjectId;
  rating: number; // 1..5
  comment?: string;
  createdAt: Date;
  updatedAt: Date;
}

const reviewSchema = new Schema<IReview>(
  {
    reservationId: {
      type: Schema.Types.ObjectId,
      ref: 'Reservation',
      required: true,
      unique: true,
      index: true,
    },
    customerId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    stylistId: { type: Schema.Types.ObjectId, ref: 'User', required: true, index: true },
    rating: { type: Number, required: true, min: 1, max: 5 },
    comment: { type: String, trim: true, maxlength: 1000 },
  },
  { timestamps: true },
);

export const Review = model<IReview>('Review', reviewSchema);
