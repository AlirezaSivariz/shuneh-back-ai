/**
 * Ratings & reviews. A customer may review a reservation only once, and only
 * after it is 'completed' (the auto-complete job handles that transition).
 * The stylist's aggregate rating is updated incrementally on each new review.
 */
import { Types } from 'mongoose';
import { Review, IReview } from '../../models/Review';
import { Reservation } from '../../models/Reservation';
import { StylistProfile } from '../../models/StylistProfile';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { storageProvider } from '../../utils/storage';

/**
 * A review is publicly VISIBLE (and counted in the rating) when it is approved.
 * Legacy reviews predating moderation have no `status` field — `$nin` includes
 * them so old data and ratings are preserved.
 */
export const VISIBLE_REVIEW_FILTER = { status: { $nin: ['pending', 'rejected'] } } as const;

async function serialize(review: IReview) {
  const customer = await User.findById(review.customerId)
    .select('firstName lastName profilePhoto')
    .lean();
  return {
    id: String(review._id),
    reservationId: String(review.reservationId),
    rating: review.rating,
    comment: review.comment ?? null,
    status: review.status ?? 'approved', // legacy (missing) → approved
    rejectionReason: review.rejectionReason ?? null,
    createdAt: review.createdAt,
    customer: customer
      ? {
          id: String(customer._id),
          fullName:
            `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || 'مشتری',
          profilePhoto: customer.profilePhoto
            ? storageProvider.getUrl(customer.profilePhoto)
            : null,
        }
      : null,
  };
}

/**
 * Recompute a stylist's aggregate rating from ONLY the visible (approved) reviews.
 * Called whenever a review's moderation status changes. Idempotent.
 */
export async function recomputeStylistRating(stylistId: Types.ObjectId | string): Promise<void> {
  const sid = typeof stylistId === 'string' ? new Types.ObjectId(stylistId) : stylistId;
  const agg = await Review.aggregate([
    { $match: { stylistId: sid, ...VISIBLE_REVIEW_FILTER } },
    { $group: { _id: null, avg: { $avg: '$rating' }, count: { $sum: 1 } } },
  ]);
  const avg = agg[0]?.avg ?? 0;
  const count = agg[0]?.count ?? 0;
  await StylistProfile.updateOne(
    { userId: sid },
    { $set: { ratingAverage: avg, ratingCount: count } },
  );
}

export async function createReview(
  customerId: string,
  reservationId: string,
  data: { rating: number; comment?: string },
) {
  if (!Types.ObjectId.isValid(reservationId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const reservation = await Reservation.findById(reservationId);
  if (!reservation) throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');

  if (String(reservation.customerId) !== customerId) {
    throw AppError.forbidden('فقط مشتری همین رزرو می‌تواند امتیاز ثبت کند', 'FORBIDDEN');
  }
  if (reservation.status !== 'completed') {
    throw AppError.badRequest(
      'فقط برای نوبت‌های انجام‌شده می‌توان امتیاز ثبت کرد',
      'RESERVATION_NOT_COMPLETED',
    );
  }

  const existing = await Review.findOne({ reservationId });
  if (existing) {
    throw AppError.conflict('برای این رزرو قبلاً امتیاز ثبت شده است', 'ALREADY_REVIEWED');
  }

  // New reviews start PENDING admin approval and do NOT affect the rating until
  // approved (the rating is recomputed on moderation).
  const review = await Review.create({
    reservationId: new Types.ObjectId(reservationId),
    customerId: new Types.ObjectId(customerId),
    stylistId: reservation.stylistId,
    rating: data.rating,
    comment: data.comment,
    status: 'pending',
  });

  return serialize(review);
}

export async function getReviewForReservation(userId: string, reservationId: string) {
  if (!Types.ObjectId.isValid(reservationId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const reservation = await Reservation.findById(reservationId).lean();
  if (!reservation) throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');
  if (String(reservation.customerId) !== userId && String(reservation.stylistId) !== userId) {
    throw AppError.forbidden('دسترسی غیرمجاز', 'FORBIDDEN');
  }
  const review = await Review.findOne({ reservationId });
  return review ? serialize(review) : null;
}

export async function listStylistReviews(
  stylistId: string,
  page = 1,
  limit = 10,
  viewerId?: string,
) {
  if (!Types.ObjectId.isValid(stylistId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const skip = (page - 1) * limit;
  // Public list shows ONLY approved reviews.
  const visibleQuery = { stylistId, ...VISIBLE_REVIEW_FILTER };
  const [items, total, profile, ownReview] = await Promise.all([
    Review.find(visibleQuery).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Review.countDocuments(visibleQuery),
    StylistProfile.findOne({ userId: stylistId }).select('ratingAverage ratingCount').lean(),
    // The logged-in viewer's OWN review (any status) — so the author sees their
    // own pending/rejected review with a status badge, even while not public.
    viewerId && Types.ObjectId.isValid(viewerId)
      ? Review.findOne({ stylistId, customerId: viewerId })
      : Promise.resolve(null),
  ]);

  const serializedItems = await Promise.all(items.map((r) => serialize(r)));
  const myReview = ownReview ? await serialize(ownReview) : null;

  return {
    // The author's own review is surfaced separately; drop it from the public
    // list to avoid showing it twice when it is approved.
    items: myReview ? serializedItems.filter((r) => r.id !== myReview.id) : serializedItems,
    myReview,
    page,
    limit,
    total,
    ratingAverage: profile?.ratingAverage ?? 0,
    ratingCount: profile?.ratingCount ?? 0,
  };
}
