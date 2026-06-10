import { Request, Response } from 'express';
import * as service from './admin.service';
import { sendSuccess } from '../../utils/response';

export async function promote(req: Request, res: Response): Promise<void> {
  const { until, tier } = req.body as { until: Date; tier?: number };
  const result = await service.promoteStylist(req.params.id, until, tier);
  sendSuccess(res, { promotion: result });
}

export async function unpromote(req: Request, res: Response): Promise<void> {
  const result = await service.unpromoteStylist(req.params.id);
  sendSuccess(res, { promotion: result });
}
