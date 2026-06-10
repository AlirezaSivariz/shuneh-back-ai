import { Router } from 'express';
import * as controller from './reservation.controller';
import * as customer from './reservation.customer.controller';
import * as reviewController from '../review/review.controller';
import { requireInternalKey } from '../../middlewares/internalKey';
import { authenticate, authorize } from '../../middlewares/auth';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createReservationSchema,
  listReservationsSchema,
  reservationIdParamsSchema,
} from './reservation.validators';
import {
  createReviewSchema,
  reservationIdParamsSchema as reviewReservationIdParams,
} from '../review/review.validators';

// Routes under /internal — operational/testing triggers.
export const internalRouter = Router();

// Manually run the reservation auto-complete pass.
internalRouter.post(
  '/reservations/complete-due',
  requireInternalKey,
  asyncHandler(controller.completeDue),
);

// Routes under /reservations — customer-facing booking (Phase 2).
export const reservationRouter = Router();
reservationRouter.use(authenticate, authorize('customer'));

reservationRouter.post('/', validate(createReservationSchema), asyncHandler(customer.create));
reservationRouter.get('/', validate(listReservationsSchema), asyncHandler(customer.list));
reservationRouter.get('/:id', validate(reservationIdParamsSchema), asyncHandler(customer.detail));
reservationRouter.post(
  '/:id/cancel',
  validate(reservationIdParamsSchema),
  asyncHandler(customer.cancel),
);

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
