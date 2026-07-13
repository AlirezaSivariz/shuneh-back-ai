import { Request, Response } from 'express';
import * as service from './settlement.service';
import { sendSuccess } from '../../utils/response';

export async function getBalance(req: Request, res: Response): Promise<void> {
  const result = await service.getSettlementBalance(req.user!.id);
  sendSuccess(res, result);
}

export async function getSettlableReservations(req: Request, res: Response): Promise<void> {
  const result = await service.getSettlableReservations(req.user!.id);
  sendSuccess(res, { items: result });
}

export async function create(req: Request, res: Response): Promise<void> {
  const result = await service.createSettlementRequest(req.user!.id, req.body);
  sendSuccess(res, result, 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const items = await service.listStylistSettlements(req.user!.id);
  sendSuccess(res, { items });
}

export async function adminList(req: Request, res: Response): Promise<void> {
  const status = req.query.status as string | undefined;
  const items = await service.adminListSettlements(
    status as any,
  );
  sendSuccess(res, { items });
}

export async function adminUpdate(req: Request, res: Response): Promise<void> {
  const result = await service.adminUpdateSettlement(
    req.params.id,
    req.user!.id,
    req.body,
  );
  sendSuccess(res, result);
}
