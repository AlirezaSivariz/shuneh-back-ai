import { NextFunction, Request, Response } from 'express';
import { config } from '../config/env';
import { AppError } from '../utils/AppError';

/**
 * Guard for /internal endpoints.
 *  - If INTERNAL_API_KEY is configured, the request must carry the matching
 *    `x-internal-key` header.
 *  - If it is NOT configured, access is allowed only in development (so the
 *    endpoints can be triggered locally without setup, but never exposed
 *    unauthenticated in production).
 */
export function requireInternalKey(req: Request, _res: Response, next: NextFunction): void {
  const expected = config.internalApiKey;

  if (!expected) {
    if (config.isDev) {
      next();
      return;
    }
    throw AppError.forbidden('Internal endpoints are disabled', 'INTERNAL_DISABLED');
  }

  const provided = req.header('x-internal-key');
  if (provided !== expected) {
    throw AppError.unauthorized('Invalid internal key', 'INVALID_INTERNAL_KEY');
  }
  next();
}
