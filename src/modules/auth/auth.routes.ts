import { Router } from 'express';
import * as controller from './auth.controller';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  requestOtpSchema,
  verifyOtpSchema,
  refreshSchema,
  logoutSchema,
} from './auth.validators';

const router = Router();

router.post('/otp/request', validate(requestOtpSchema), asyncHandler(controller.requestOtp));
router.post('/otp/verify', validate(verifyOtpSchema), asyncHandler(controller.verifyOtp));
router.post('/refresh', validate(refreshSchema), asyncHandler(controller.refresh));
router.post('/logout', validate(logoutSchema), asyncHandler(controller.logout));

export default router;
