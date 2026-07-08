import { Request, Response } from 'express';
import * as service from './invoice.service';
import { sendSuccess } from '../../utils/response';

export async function getInvoice(req: Request, res: Response): Promise<void> {
  const result = await service.getReservationInvoice(req.user!.id, req.params.id);
  sendSuccess(res, result);
}
