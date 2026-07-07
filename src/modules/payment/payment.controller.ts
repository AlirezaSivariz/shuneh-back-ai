import { Request, Response } from 'express';
import * as service from './payment.service';
import { sendSuccess } from '../../utils/response';

/**
 * POST /payments/zibal/request — start a generic Zibal payment (authenticated).
 * Returns the gateway redirect URL; the frontend sends the browser to `paymentUrl`.
 */
export async function startPayment(req: Request, res: Response): Promise<void> {
  const { amount, orderId, description, mobile } = req.body;
  sendSuccess(
    res,
    await service.startPayment(req.user!.id, { amountToman: amount, orderId, description, mobile }),
    201,
  );
}

/**
 * POST /payments/plan — start an online subscription-plan purchase (stylist).
 * Returns the gateway redirect URL; the tier is granted on the verified callback.
 */
export async function startPlanPurchase(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.startPlanPurchase(req.user!.id, req.body.tier), 201);
}

/**
 * POST /payments/topup — start a Zibal wallet top-up (authenticated). Returns the
 * gateway redirect URL; the frontend then sends the browser to `paymentUrl`.
 */
export async function startTopup(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.startWalletTopup(req.user!.id, req.body.amount), 201);
}

/**
 * GET /payments/callback — Zibal returns the browser here after payment. This is
 * NOT a JSON API: it always ends in a 302 redirect to the frontend result page,
 * even on error (the service never throws for this path).
 */
export async function callback(req: Request, res: Response): Promise<void> {
  const { trackId, success, orderId } = req.query as Record<string, string>;
  const { redirectUrl } = await service.handleCallback({ trackId, success, orderId });
  res.redirect(302, redirectUrl);
}
