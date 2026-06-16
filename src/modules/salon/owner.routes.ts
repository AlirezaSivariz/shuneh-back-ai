import { Router } from 'express';
import * as controller from './salon.controller';
import { validate } from '../../middlewares/validate';
import { authenticate, authorize } from '../../middlewares/auth';
import { requireSalonOwner } from '../../middlewares/salonOwner';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  salonStylistsSchema,
  stylistApprovalParamsSchema,
  updateSalonSchema,
  inviteStylistSchema,
  ownerStylistSearchSchema,
} from './salon.validators';

// Routes under /owner — salon management from the owner's perspective.
// Every route requires the 'owner' role; salon-scoped routes additionally
// verify (via requireSalonOwner) that req.user owns that specific salon.
export const ownerRouter = Router();

ownerRouter.use(authenticate, authorize('owner'));

// List all salons this owner owns (active and pending).
ownerRouter.get('/salons', asyncHandler(controller.listOwnerSalons));

// Find stylists (by name) to invite into a salon.
ownerRouter.get(
  '/stylists/search',
  validate(ownerStylistSearchSchema),
  asyncHandler(controller.searchStylistsForInvite),
);

// Owner invites a stylist to a salon (reverse of the join flow → stylist accepts).
ownerRouter.post(
  '/salons/:salonId/invite-stylist',
  validate(inviteStylistSchema),
  requireSalonOwner,
  asyncHandler(controller.inviteStylist),
);

// Edit one of the owner's salons.
ownerRouter.patch(
  '/salons/:salonId',
  validate(updateSalonSchema),
  requireSalonOwner,
  asyncHandler(controller.updateSalon),
);

// Stylist requests/members of a salon (filterable by status).
ownerRouter.get(
  '/salons/:salonId/stylists',
  validate(salonStylistsSchema),
  requireSalonOwner,
  asyncHandler(controller.listSalonStylists),
);

// Approve / reject a stylist's membership.
ownerRouter.post(
  '/salons/:salonId/stylists/:stylistId/approve',
  validate(stylistApprovalParamsSchema),
  requireSalonOwner,
  asyncHandler(controller.approveStylist),
);
ownerRouter.post(
  '/salons/:salonId/stylists/:stylistId/reject',
  validate(stylistApprovalParamsSchema),
  requireSalonOwner,
  asyncHandler(controller.rejectStylist),
);
