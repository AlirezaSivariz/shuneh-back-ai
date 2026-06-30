import { Router } from 'express';
import * as controller from './reservation.controller';
import * as customer from './reservation.customer.controller';
import * as reviewController from '../review/review.controller';
import { requireInternalKey } from '../../middlewares/internalKey';
import { purgeExpiredStories } from '../social/story.service';
import { authenticate } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createReservationSchema,
  listReservationsSchema,
  reservationIdParamsSchema,
  rescheduleSchema,
  tipSchema,
} from './reservation.validators';
import {
  createReviewSchema,
  reservationIdParamsSchema as reviewReservationIdParams,
} from '../review/review.validators';
import { validateDiscountSchema } from '../discount/discount.validators';

// Routes under /internal — operational/testing triggers.
export const internalRouter = Router();

// Manually run the reservation auto-complete pass.
internalRouter.post(
  '/reservations/complete-due',
  requireInternalKey,
  asyncHandler(controller.completeDue),
);

// Manually purge expired 24h stories (fallback when no in-process cron runs).
internalRouter.post(
  '/stories/purge',
  requireInternalKey,
  asyncHandler(async (_req, res) => {
    const result = await purgeExpiredStories();
    res.json({ success: true, data: result });
  }),
);

// Routes under /reservations — customer-facing booking (Phase 2).
// Only `authenticate` is required (NOT authorize('customer')): every handler is
// already scoped to the caller's own data (customerId === req.user.id), and ANY
// logged-in user may book as a customer — including multi-role users (e.g. a
// stylist booking someone else) who haven't picked the 'customer' role yet. The
// customer role is granted idempotently when they actually book. Gating the
// whole router on the 'customer' role wrongly blocked discount validation (which
// runs BEFORE the role is granted) with a role error.
export const reservationRouter = Router();
reservationRouter.use(authenticate);

reservationRouter.post('/', validate(createReservationSchema), asyncHandler(customer.create));
// Preview/validate a discount code before booking (literal path before '/:id').
reservationRouter.post(
  '/validate-discount',
  validate(validateDiscountSchema),
  asyncHandler(customer.validateDiscount),
);
reservationRouter.get('/', validate(listReservationsSchema), asyncHandler(customer.list));
reservationRouter.get('/:id', validate(reservationIdParamsSchema), asyncHandler(customer.detail));
// Cancellation/reschedule policy + computed refund/penalty preview (no writes).
reservationRouter.get(
  '/:id/cancellation-preview',
  validate(reservationIdParamsSchema),
  asyncHandler(customer.cancellationPreview),
);
reservationRouter.post(
  '/:id/cancel',
  validate(reservationIdParamsSchema),
  asyncHandler(customer.cancel),
);
// Reschedule to a new date/time (services unchanged).
reservationRouter.patch(
  '/:id/reschedule',
  validate(rescheduleSchema),
  asyncHandler(customer.reschedule),
);
// Record a tip for a completed reservation.
reservationRouter.post('/:id/tip', validate(tipSchema), asyncHandler(customer.tip));

// Ratings & reviews for a (completed) reservation.
reservationRouter.post(
  '/:id/review',
  validate(createReviewSchema),
  asyncHandler(reviewController.create),
);
reservationRouter.get(
  '/:id/review',
  validate(reviewReservationIdParams),
  asyncHandler(reviewController.getForReservation),
);
