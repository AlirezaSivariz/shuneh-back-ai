import { Request, Response } from 'express';
import * as referralService from './referral.service';
import { sendSuccess } from '../../utils/response';

export async function getMyReferral(req: Request, res: Response): Promise<void> {
  const referral = await referralService.getMyReferral(req.user!.id);
  sendSuccess(res, referral);
}

export async function claim(req: Request, res: Response): Promise<void> {
  const result = await referralService.claimReferral(req.user!.id, req.body.code);
  sendSuccess(res, result);
}