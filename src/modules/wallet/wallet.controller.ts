import { Request, Response } from 'express';
import * as service from './wallet.service';
import { sendSuccess } from '../../utils/response';

/** GET /me/wallet — current balance + summary (own wallet only). */
export async function getWallet(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getWallet(req.user!.id));
}

/** GET /me/wallet/transactions — paginated history (own wallet only). */
export async function listTransactions(req: Request, res: Response): Promise<void> {
  const { page, limit } = req.query as Record<string, string>;
  sendSuccess(res, await service.listTransactions(req.user!.id, Number(page), Number(limit)));
}

/** POST /me/wallet/topup — start a top-up (records pending; no balance change). */
export async function topup(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.startTopup(req.user!.id, req.body.amount), 201);
}
