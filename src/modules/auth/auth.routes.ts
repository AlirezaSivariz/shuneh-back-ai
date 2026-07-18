import { Router } from 'express';
import * as controller from './auth.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  requestOtpSchema,
  verifyOtpSchema,
  refreshSchema,
  logoutSchema,
  passwordLoginSchema,
  setPasswordSchema,
  resetPasswordSchema,
} from './auth.validators';

const router = Router();

router.post('/otp/request', validate(requestOtpSchema), asyncHandler(controller.requestOtp));
router.post('/otp/verify', validate(verifyOtpSchema), asyncHandler(controller.verifyOtp));
router.post('/refresh', validate(refreshSchema), asyncHandler(controller.refresh));
router.post('/logout', validate(logoutSchema), asyncHandler(controller.logout));

router.post(
  '/password/login',
  validate(passwordLoginSchema),
  asyncHandler(controller.loginWithPassword),
);
router.post(
  '/password/set',
  authenticate,
  validate(setPasswordSchema),
  asyncHandler(controller.setPassword),
);
router.post(
  '/password/reset',
  validate(resetPasswordSchema),
  asyncHandler(controller.resetPassword),
);

export default router;
