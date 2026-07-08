import { Request, Response } from 'express';
import * as service from './invoice.service';
import { sendSuccess } from '../../utils/response';

export async function getInvoice(req: Request, res: Response): Promise<void> {
  const roles = req.user!.roles;
  let viewer: 'customer' | 'stylist' | 'admin' = 'customer';
  if (roles.includes('admin')) viewer = 'admin';
  else if (roles.includes('stylist')) viewer = 'stylist';
  const result = await service.getReservationInvoice(req.user!.id, req.params.id, viewer);
  sendSuccess(res, result);
}
