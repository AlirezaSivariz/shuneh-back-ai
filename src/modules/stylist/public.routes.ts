import { Router } from 'express';
import * as controller from './public.controller';
import * as reviewController from '../review/review.controller';
import { validate } from '../../middlewares/validate';
import { optionalAuthenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  searchStylistsSchema,
  homeStylistsSchema,
  stylistIdParamsSchema,
  availabilitySchema,
  availableDaysSchema,
  cancellationPolicySchema,
} from './public.validators';
import { stylistReviewsSchema } from '../review/review.validators';

// Public, customer-facing stylist discovery. Mounted at /stylists (plural).
const router = Router();

router.get('/search', validate(searchStylistsSchema), asyncHandler(controller.search));
// Promoted stylists for the landing "featured" section.
router.get('/featured', asyncHandler(controller.featured));
// Landing "متخصصین" section: promoted first, then a quality fallback so it's
// never empty while any bookable stylist exists.
router.get('/home', validate(homeStylistsSchema), asyncHandler(controller.home));
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
  optionalAuthenticate, // personalize for the logged-in author (their own review)
  validate(stylistReviewsSchema),
  asyncHandler(reviewController.listForStylist),
);
// Cancellation policy that would apply when booking this stylist (booking UI).
router.get(
  '/:id/cancellation-policy',
  validate(cancellationPolicySchema),
  asyncHandler(controller.cancellationPolicy),
);
router.get('/:id', validate(stylistIdParamsSchema), asyncHandler(controller.profile));

export default router;
