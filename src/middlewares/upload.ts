import fs from 'fs';
import path from 'path';
import multer from 'multer';
import { Request } from 'express';
import { config } from '../config/env';
import { AppError } from '../utils/AppError';

const MAX_FILE_SIZE = 5 * 1024 * 1024; // 5 MB
const ALLOWED_MIME = ['image/jpeg', 'image/png', 'image/webp'];

/**
 * Build a multer instance that stores images on disk under UPLOAD_DIR/<subdir>.
 * Only image files within the size limit are accepted.
 */
export function createUploader(subdir: string) {
  const destination = path.resolve(config.uploadDir, subdir);
  fs.mkdirSync(destination, { recursive: true });

  const storage = multer.diskStorage({
    destination: (_req, _file, cb) => cb(null, destination),
    filename: (_req, file, cb) => {
      const ext = path.extname(file.originalname).toLowerCase();
      const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
      cb(null, unique);
    },
  });

  return multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req: Request, file, cb) => {
      if (!ALLOWED_MIME.includes(file.mimetype)) {
        cb(AppError.badRequest('Only JPEG, PNG and WebP images are allowed', 'INVALID_FILE_TYPE'));
        return;
      }
      cb(null, true);
    },
  });
}
