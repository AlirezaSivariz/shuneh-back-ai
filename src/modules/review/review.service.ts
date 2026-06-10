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

async function serialize(review: IReview) {
  const customer = await User.findById(review.customerId)
    .select('firstName lastName profilePhoto')
    .lean();
  return {
    id: String(review._id),
    reservationId: String(review.reservationId),
    rating: review.rating,
    comment: review.comment ?? null,
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

  const review = await Review.create({
    reservationId: new Types.ObjectId(reservationId),
    customerId: new Types.ObjectId(customerId),
    stylistId: reservation.stylistId,
    rating: data.rating,
    comment: data.comment,
  });

  // Atomic incremental update of the stylist's aggregate rating.
  await StylistProfile.updateOne({ userId: reservation.stylistId }, [
    {
      $set: {
        ratingAverage: {
          $divide: [
            { $add: [{ $multiply: ['$ratingAverage', '$ratingCount'] }, data.rating] },
            { $add: ['$ratingCount', 1] },
          ],
        },
        ratingCount: { $add: ['$ratingCount', 1] },
      },
    },
  ]);

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

export async function listStylistReviews(stylistId: string, page = 1, limit = 10) {
  if (!Types.ObjectId.isValid(stylistId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const skip = (page - 1) * limit;
  const [items, total, profile] = await Promise.all([
    Review.find({ stylistId }).sort({ createdAt: -1 }).skip(skip).limit(limit),
    Review.countDocuments({ stylistId }),
    StylistProfile.findOne({ userId: stylistId }).select('ratingAverage ratingCount').lean(),
  ]);

  return {
    items: await Promise.all(items.map((r) => serialize(r))),
    page,
    limit,
    total,
    ratingAverage: profile?.ratingAverage ?? 0,
    ratingCount: profile?.ratingCount ?? 0,
  };
}
