import { Request, Response } from 'express';
import * as service from './media.service';
import { sendSuccess } from '../../utils/response';

export async function uploadStylistMedia(req: Request, res: Response): Promise<void> {
  const files = (req.files ?? {}) as {
    profilePhoto?: Express.Multer.File[];
    portfolio?: Express.Multer.File[];
  };
  const result = await service.saveStylistMedia(req.user!.id, files);
  sendSuccess(res, result);
}
