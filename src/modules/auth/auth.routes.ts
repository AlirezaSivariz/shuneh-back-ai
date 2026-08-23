import { Router } from 'express';
import * as controller from './auth.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { rateLimit } from '../../middlewares/rateLimit';
import { config } from '../../config/env';
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

// Rate limiter is skipped in test to avoid IP-collision between parallel tests.
const rl = config.isDev && config.nodeEnv !== 'test'
  ? (opts: { windowMs: number; max: number; key: string }) => rateLimit(opts)
  : () => (_req: any, _res: any, next: any) => next();

// ── Rate-limited public auth endpoints ──
// OTP request: 3 per IP per 5 min (SMS cost protection).
router.post(
  '/otp/request',
  rl({ windowMs: 5 * 60_000, max: 3, key: 'otp-request' }),
  validate(requestOtpSchema),
  asyncHandler(controller.requestOtp),
);
// OTP verify: 5 per IP per 5 min (brute-force protection).
router.post(
  '/otp/verify',
  rl({ windowMs: 5 * 60_000, max: 5, key: 'otp-verify' }),
  validate(verifyOtpSchema),
  asyncHandler(controller.verifyOtp),
);
// Password login: 5 per IP per 5 min (brute-force protection).
router.post(
  '/password/login',
  rl({ windowMs: 5 * 60_000, max: 5, key: 'password-login' }),
  validate(passwordLoginSchema),
  asyncHandler(controller.loginWithPassword),
);
// Password reset request: 3 per IP per 10 min.
router.post(
  '/password/reset',
  rl({ windowMs: 10 * 60_000, max: 3, key: 'password-reset' }),
  validate(resetPasswordSchema),
  asyncHandler(controller.resetPassword),
);

// ── Non-rate-limited (authenticated or safe) ──
router.post('/refresh', validate(refreshSchema), asyncHandler(controller.refresh));
router.post('/logout', validate(logoutSchema), asyncHandler(controller.logout));

router.post(
  '/password/set',
  authenticate,
  validate(setPasswordSchema),
  asyncHandler(controller.setPassword),
);

export default router;
