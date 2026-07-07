import { Request, Response } from 'express';
import * as service from './plan.service';
import { sendSuccess } from '../../utils/response';

export async function getPlans(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, { items: service.getPlans() });
}
