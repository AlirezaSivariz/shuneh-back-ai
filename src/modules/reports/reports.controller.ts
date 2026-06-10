import { Request, Response } from 'express';
import * as service from './reports.service';
import { sendSuccess } from '../../utils/response';

export async function stylistReport(req: Request, res: Response): Promise<void> {
  const { from, to } = req.query as unknown as { from: string; to: string };
  const report = await service.getStylistReport(req.user!.id, from, to);
  sendSuccess(res, report);
}

export async function customerReport(req: Request, res: Response): Promise<void> {
  const { from, to } = req.query as unknown as { from: string; to: string };
  const report = await service.getCustomerReport(req.user!.id, from, to);
  sendSuccess(res, report);
}
