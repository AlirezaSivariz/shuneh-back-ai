import { NextFunction, Request, Response } from 'express';
import { verifyAccessToken } from '../utils/jwt';
import { AppError } from '../utils/AppError';
import { Role, User } from '../models/User';

/**
 * Validate the Bearer access token and attach req.user.
 *
 * Roles are loaded fresh from the database (not trusted from the token) so that
 * a role added mid-session — e.g. via POST /onboarding/role — takes effect
 * immediately, without forcing the client to refresh its access token first.
 */
export async function authenticate(
  req: Request,
  _res: Response,
  next: NextFunction,
): Promise<void> {
  try {
    const header = req.headers.authorization;
    if (!header || !header.startsWith('Bearer ')) {
      throw AppError.unauthorized('Missing or malformed Authorization header');
    }

    const token = header.slice('Bearer '.length).trim();
    const payload = verifyAccessToken(token);

    const user = await User.findById(payload.sub).select('roles');
    if (!user) {
      throw AppError.unauthorized('User no longer exists', 'USER_NOT_FOUND');
    }

    req.user = { id: payload.sub, roles: user.roles };
    next();
  } catch (err) {
    if (err instanceof AppError) {
      next(err);
      return;
    }
    next(AppError.unauthorized('Invalid or expired access token', 'INVALID_TOKEN'));
  }
}

/**
 * Allow only users having at least one of the given roles.
 */
export function authorize(...roles: Role[]) {
  return (req: Request, _res: Response, next: NextFunction): void => {
    if (!req.user) throw AppError.unauthorized();
    const allowed = req.user.roles.some((r) => roles.includes(r));
    if (!allowed) {
      throw AppError.forbidden(`Requires one of roles: ${roles.join(', ')}`);
    }
    next();
  };
}
