import { NextFunction, Request, Response } from 'express';
import { Salon } from '../models/Salon';
import { AppError } from '../utils/AppError';

/**
 * Ensure the authenticated user owns the salon identified by :salonId.
 * Loads the salon and stashes it on res.locals.salon for downstream handlers,
 * so they don't need to re-query it.
 *
 * Must run after `authenticate`.
 */
export async function requireSalonOwner(
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    if (!req.user) throw AppError.unauthorized();

    const { salonId } = req.params;
    const salon = await Salon.findById(salonId);
    if (!salon) throw AppError.notFound('سالن یافت نشد', 'SALON_NOT_FOUND');

    if (!salon.ownerId || String(salon.ownerId) !== req.user.id) {
      throw AppError.forbidden(
        'فقط مالک این سالن اجازه‌ی انجام این عملیات را دارد',
        'NOT_SALON_OWNER',
      );
    }

    res.locals.salon = salon;
    next();
  } catch (err) {
    next(err);
  }
}
