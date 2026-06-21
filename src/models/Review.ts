import { Schema, model, Document, Types } from 'mongoose';

export type ReviewStatus = 'pending' | 'approved' | 'rejected';
export const REVIEW_STATUSES: ReviewStatus[] = ['pending', 'approved', 'rejected'];

/**
 * A customer's rating/review of a completed reservation. One review per
 * reservation (enforced by the unique index on reservationId).
 *
 * Moderation: a new review starts 'pending' and is only shown publicly (and
 * counted in the stylist's rating) once an admin approves it. Reviews created
 * BEFORE moderation existed have no `status` field; they are treated as
 * approved/visible via a `$nin: ['pending','rejected']` filter so legacy data
 * (and the ratings derived from it) are preserved.
 */
export interface IReview extends Document {
  _id: Types.ObjectId;
  reservationId: Types.ObjectId;
  customerId: Types.ObjectId;
  stylistId: Types.ObjectId;
  rating: number; // 1..5
  comment?: string;
  status: ReviewStatus;
  rejectionReason?: string | null;
  moderatedBy?: Types.ObjectId | null;
  moderatedAt?: Date | null;
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
    status: { type: String, enum: REVIEW_STATUSES, default: 'pending', index: true },
    rejectionReason: { type: String, default: null },
    moderatedBy: { type: Schema.Types.ObjectId, ref: 'User', default: null },
    moderatedAt: { type: Date, default: null },
  },
  { timestamps: true },
);

export const Review = model<IReview>('Review', reviewSchema);
