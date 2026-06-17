import { Request, Response } from 'express';
import { storageProvider } from '../../utils/storage';
import { AppError } from '../../utils/AppError';

// Public images (profile/portfolio) never change → cache hard.
const PUBLIC_CACHE = 'public, max-age=31536000, immutable';

export async function getImage(req: Request, res: Response): Promise<void> {
  const image = await storageProvider.getImage(req.params.id);
  if (!image) throw AppError.notFound('تصویر یافت نشد', 'IMAGE_NOT_FOUND');
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Cache-Control', PUBLIC_CACHE);
  res.send(image.data);
}

export async function getThumbnail(req: Request, res: Response): Promise<void> {
  const image = await storageProvider.getThumbnail(req.params.id);
  if (!image) throw AppError.notFound('تصویر یافت نشد', 'IMAGE_NOT_FOUND');
  res.setHeader('Content-Type', image.mime);
  res.setHeader('Cache-Control', PUBLIC_CACHE);
  res.send(image.data);
}
