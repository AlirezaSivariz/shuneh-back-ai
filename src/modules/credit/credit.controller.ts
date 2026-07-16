import { Request, Response } from 'express';
import * as service from './credit.service';
import { sendSuccess } from '../../utils/response';

export async function getWallet(req: Request, res: Response): Promise<void> {
  const result = await service.getWallet(req.user!.id);
  sendSuccess(res, result);
}

export async function listTransactions(req: Request, res: Response): Promise<void> {
  const { page, limit } = req.query as Record<string, string>;
  const result = await service.listTransactions(
    req.user!.id,
    Number(page) || 1,
    Number(limit) || 20,
  );
  sendSuccess(res, result);
}

export async function getPublicSettings(req: Request, res: Response): Promise<void> {
  const result = await service.getCreditSettings();
  sendSuccess(res, {
    completedReservationCredit: result.completedReservationCredit,
    fiveStarReviewCredit: result.fiveStarReviewCredit,
    consecutiveCancelPenalty: result.consecutiveCancelPenalty,
    consecutiveCancelThreshold: result.consecutiveCancelThreshold,
    silverCreditPrice: result.silverCreditPrice,
    goldCreditPrice: result.goldCreditPrice,
    isEnabled: result.isEnabled,
  });
}

export async function purchasePlan(req: Request, res: Response): Promise<void> {
  const { tier } = req.body as { tier: 'silver' | 'gold' };
  const result = await service.purchasePlanByCredit(req.user!.id, tier);
  sendSuccess(res, result);
}
