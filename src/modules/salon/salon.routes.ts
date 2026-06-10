import { Router } from 'express';
import * as controller from './salon.controller';
import { validate } from '../../middlewares/validate';
import { authenticate, authorize } from '../../middlewares/auth';
import { requireSalonOwner } from '../../middlewares/salonOwner';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  searchSalonsSchema,
  createSalonSchema,
  salonInviteSchema,
  stylistApprovalParamsSchema,
  salonStylistsSchema,
} from './salon.validators';

const router = Router();

// Geo + name search (used during stylist workplace onboarding).
router.get(
  '/search',
  authenticate,
  validate(searchSalonsSchema),
  asyncHandler(controller.search),
);

// Stylist creates a salon they own.
router.post(
  '/',
  authenticate,
  authorize('stylist'),
  validate(createSalonSchema),
  asyncHandler(controller.createSalon),
);

// Stylist registers a salon on behalf of its real owner (invite flow).
router.post(
  '/invite',
  authenticate,
  authorize('stylist'),
  validate(salonInviteSchema),
  asyncHandler(controller.createInvite),
);

// Owner views the stylist requests for one of their salons.
router.get(
  '/:salonId/stylists',
  authenticate,
  validate(salonStylistsSchema),
  requireSalonOwner,
  asyncHandler(controller.listSalonStylists),
);

// Owner approves / rejects a stylist's membership (only the salon's owner).
router.post(
  '/:salonId/stylists/:stylistId/approve',
  authenticate,
  validate(stylistApprovalParamsSchema),
  requireSalonOwner,
  asyncHandler(controller.approveStylist),
);

router.post(
  '/:salonId/stylists/:stylistId/reject',
  authenticate,
  validate(stylistApprovalParamsSchema),
  requireSalonOwner,
  asyncHandler(controller.rejectStylist),
);

export default router;
