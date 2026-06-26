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
 *
 * Pass `{ private: true }` to store under PRIVATE_UPLOAD_DIR (never served by
 * the public /uploads mount) — for sensitive files such as ID documents.
 */
export function createUploader(subdir: string, opts: { private?: boolean } = {}) {
  // Remote/object drivers need raw bytes in memory to validate and re-encode.
  let storage: multer.StorageEngine;
  if (config.storageDriver === 'mongo' || config.storageDriver === 's3') {
    storage = multer.memoryStorage();
  } else {
    const root = opts.private ? config.privateUploadDir : config.uploadDir;
    const destination = path.resolve(root, subdir);
    fs.mkdirSync(destination, { recursive: true });
    storage = multer.diskStorage({
      destination: (_req, _file, cb) => cb(null, destination),
      filename: (_req, file, cb) => {
        const ext = path.extname(file.originalname).toLowerCase();
        const unique = `${Date.now()}-${Math.round(Math.random() * 1e9)}${ext}`;
        cb(null, unique);
      },
    });
  }

  return multer({
    storage,
    limits: { fileSize: MAX_FILE_SIZE },
    fileFilter: (_req: Request, file, cb) => {
      if (!ALLOWED_MIME.includes(file.mimetype)) {
        cb(AppError.badRequest('فقط تصاویر JPEG، PNG و WebP مجاز است', 'INVALID_FILE_TYPE'));
        return;
      }
      cb(null, true);
    },
  });
}
