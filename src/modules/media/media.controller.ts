import { Request, Response } from 'express';
import * as service from './media.service';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';

export async function uploadStylistMedia(req: Request, res: Response): Promise<void> {
  const files = (req.files ?? {}) as {
    profilePhoto?: Express.Multer.File[];
    portfolio?: Express.Multer.File[];
  };
  const result = await service.saveStylistMedia(req.user!.id, files);
  sendSuccess(res, result);
}

export async function uploadProfilePhoto(req: Request, res: Response): Promise<void> {
  const result = await service.saveProfilePhoto(req.user!.id, req.file);
  sendSuccess(res, result);
}

export async function deletePortfolioItem(req: Request, res: Response): Promise<void> {
  const key = typeof req.body?.key === 'string' ? req.body.key.trim() : '';
  if (!key) throw AppError.badRequest('شناسه‌ی نمونه‌کار لازم است', 'KEY_REQUIRED');
  const result = await service.deletePortfolioItem(req.user!.id, key);
  sendSuccess(res, result);
}
