import { Request, Response } from 'express';
import * as service from './service.service';
import { sendSuccess } from '../../utils/response';

export async function listServices(_req: Request, res: Response): Promise<void> {
  const categories = await service.listCategoriesWithServices();
  sendSuccess(res, { categories });
}
