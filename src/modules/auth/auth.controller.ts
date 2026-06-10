import { Request, Response } from 'express';
import * as authService from './auth.service';
import { sendSuccess } from '../../utils/response';

function publicUser(user: {
  _id: unknown;
  phone: string;
  roles: string[];
  firstName?: string;
  lastName?: string;
}) {
  return {
    id: String(user._id),
    phone: user.phone,
    roles: user.roles,
    firstName: user.firstName,
    lastName: user.lastName,
  };
}

export async function requestOtp(req: Request, res: Response): Promise<void> {
  const result = await authService.requestOtp(req.body.phone);
  sendSuccess(res, result, 201);
}

export async function verifyOtp(req: Request, res: Response): Promise<void> {
  const { phone, code } = req.body;
  const { user, tokens, isNewUser } = await authService.verifyOtp(phone, code);
  sendSuccess(res, { user: publicUser(user), tokens, isNewUser });
}

export async function refresh(req: Request, res: Response): Promise<void> {
  const tokens = await authService.refresh(req.body.refreshToken);
  sendSuccess(res, { tokens });
}

export async function logout(req: Request, res: Response): Promise<void> {
  await authService.logout(req.body.refreshToken);
  sendSuccess(res, { message: 'Logged out' });
}
