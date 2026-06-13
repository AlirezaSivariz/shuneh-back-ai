import { Request, Response } from 'express';
import * as service from './discount.service';
import { sendSuccess } from '../../utils/response';

export async function create(req: Request, res: Response): Promise<void> {
  const code = await service.createDiscountCode(req.user!.id, req.body);
  sendSuccess(res, { discountCode: code }, 201);
}

export async function list(req: Request, res: Response): Promise<void> {
  const codes = await service.listDiscountCodes(req.user!.id);
  sendSuccess(res, { discountCodes: codes });
}

export async function update(req: Request, res: Response): Promise<void> {
  const code = await service.updateDiscountCode(req.user!.id, req.params.id, req.body);
  sendSuccess(res, { discountCode: code });
}

export async function remove(req: Request, res: Response): Promise<void> {
  const result = await service.deleteDiscountCode(req.user!.id, req.params.id);
  sendSuccess(res, result);
}
