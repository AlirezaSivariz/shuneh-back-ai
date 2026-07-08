import { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response';
import * as service from './transaction.service';

export async function listMy(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = await service.listMyTransactions(userId, {
    status: req.query.status as string | undefined,
    purpose: req.query.purpose as string | undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  sendSuccess(res, result);
}

export async function getMy(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const tx = await service.getMyTransaction(userId, req.params.id);
  sendSuccess(res, tx);
}

export async function listStylist(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = await service.listStylistTransactions(userId, {
    status: req.query.status as string | undefined,
    purpose: req.query.purpose as string | undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  sendSuccess(res, result);
}

export async function getStylist(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const tx = await service.getStylistTransaction(userId, req.params.id);
  sendSuccess(res, tx);
}

export async function stats(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = await service.getStylistTransactionStats(userId);
  sendSuccess(res, result);
}
