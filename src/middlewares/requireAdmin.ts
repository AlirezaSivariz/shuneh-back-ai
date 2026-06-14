import { NextFunction, Request, Response } from 'express';
import { AppError } from '../utils/AppError';

/**
 * Strict admin guard. MUST be mounted AFTER `authenticate` (which attaches
 * req.user and already rejects disabled accounts). Allows the request only if
 * the authenticated user carries the 'admin' role. Every /admin route is
 * protected by this — there is no admin endpoint without it.
 */
export function requireAdmin(req: Request, _res: Response, next: NextFunction): void {
  if (!req.user) throw AppError.unauthorized();
  if (!req.user.roles.includes('admin')) {
    throw AppError.forbidden('دسترسی فقط برای پشتیبانی', 'ADMIN_ONLY');
  }
  next();
}
