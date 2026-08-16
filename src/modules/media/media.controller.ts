import { Request, Response } from 'express';
import * as service from './media.service';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';

export async function uploadStylistMedia(req: Request, res: Response): Promise<void> {
  const files = (req.files ?? {}) as {
    profilePhoto?: Express.Multer.File[];
    portfolio?: Express.Multer.File[];
    cover?: Express.Multer.File[];
  };
  const slogan =
    typeof req.body?.slogan === 'string' ? req.body.slogan.slice(0, 30) : undefined;
  const result = await service.saveStylistMedia(req.user!.id, files, slogan);
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

export async function deleteCover(req: Request, res: Response): Promise<void> {
  const result = await service.deleteCover(req.user!.id);
  sendSuccess(res, result);
}
