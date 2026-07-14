import { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response';
import * as service from './bank.service';

export async function getBankInfo(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getBankInfo(req.user!.id));
}

export async function setBankInfo(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.setBankInfo(req.user!.id, req.body));
}
