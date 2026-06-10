import { Router } from 'express';
import * as controller from './public.controller';
import * as reviewController from '../review/review.controller';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  searchStylistsSchema,
  stylistIdParamsSchema,
  availabilitySchema,
  availableDaysSchema,
} from './public.validators';
import { stylistReviewsSchema } from '../review/review.validators';

// Public, customer-facing stylist discovery. Mounted at /stylists (plural).
const router = Router();

router.get('/search', validate(searchStylistsSchema), asyncHandler(controller.search));
// Promoted stylists for the landing "featured" section.
router.get('/featured', asyncHandler(controller.featured));
router.get(
  '/:id/availability',
  validate(availabilitySchema),
  asyncHandler(controller.availability),
);
router.get(
  '/:id/available-days',
  validate(availableDaysSchema),
  asyncHandler(controller.availableDays),
);
router.get(
  '/:id/reviews',
  validate(stylistReviewsSchema),
  asyncHandler(reviewController.listForStylist),
);
router.get('/:id', validate(stylistIdParamsSchema), asyncHandler(controller.profile));

export default router;
