import { Router } from 'express';
import * as controller from './payment.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { callbackSchema, zibalRequestSchema, planPurchaseSchema } from './payment.validators';
import { topupSchema } from '../wallet/wallet.validators';

// Routes under /payments (Zibal gateway).
const router = Router();

// Generic gateway start — the primary entry point used by the frontend
// PaymentForm. Returns { paymentUrl, trackId, orderId, transactionId, … }.
router.post(
  '/zibal/request',
  authenticate,
  validate(zibalRequestSchema),
  asyncHandler(controller.startPayment),
);

// Start a wallet top-up (own wallet only). Returns { paymentUrl, trackId, … }.
router.post('/topup', authenticate, validate(topupSchema), asyncHandler(controller.startTopup));

// Buy a subscription plan online (stylist). Tier is applied on the callback.
router.post('/plan', authenticate, validate(planPurchaseSchema), asyncHandler(controller.startPlanPurchase));

// Public callback — Zibal redirects the user's BROWSER here (no auth header).
// Always ends in a 302 to the frontend result page.
router.get('/callback', validate(callbackSchema), asyncHandler(controller.callback));

export default router;
