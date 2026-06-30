import { Router } from 'express';
import * as controller from './salon.controller';
import { validate } from '../../middlewares/validate';
import { authenticate, authorize, optionalAuthenticate } from '../../middlewares/auth';
import { requireSalonOwner } from '../../middlewares/salonOwner';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  searchSalonsSchema,
  createSalonSchema,
  salonInviteSchema,
  byOwnerPhoneSchema,
  stylistApprovalParamsSchema,
  salonStylistsSchema,
  salonDetailParamsSchema,
} from './salon.validators';

const router = Router();

// Public geo + name search (active salons). Also reused by the stylist workplace
// onboarding flow (authenticated). optionalAuthenticate keeps both working.
router.get(
  '/search',
  optionalAuthenticate,
  validate(searchSalonsSchema),
  asyncHandler(controller.search),
);

// Stylist looks up an owner's existing salons by phone (to join instead of
// creating a duplicate). Privacy: returns salon info only, no owner identity.
router.get(
  '/by-owner-phone',
  authenticate,
  authorize('stylist'),
  validate(byOwnerPhoneSchema),
  asyncHandler(controller.byOwnerPhone),
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

// Public salon detail + its bookable stylists. Registered LAST so the literal
// routes above (/search, /by-owner-phone) are never shadowed by `:id`.
router.get(
  '/:id',
  optionalAuthenticate,
  validate(salonDetailParamsSchema),
  asyncHandler(controller.salonDetail),
);

export default router;
