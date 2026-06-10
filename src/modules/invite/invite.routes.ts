import { Router } from 'express';
import * as controller from './invite.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { inviteTokenParamsSchema, acceptInviteSchema } from './invite.validators';

const router = Router();

// Public: view the invite + pending salon + requesting stylist.
router.get('/:token', validate(inviteTokenParamsSchema), asyncHandler(controller.getInvite));

// The invited owner (logged in via OTP, phone must match targetPhone) claims &
// confirms the salon. The 'owner' role is granted inside acceptInvite.
router.post(
  '/:token/accept',
  authenticate,
  validate(acceptInviteSchema),
  asyncHandler(controller.acceptInvite),
);

export default router;
