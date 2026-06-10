import { Request, Response } from 'express';
import * as service from './invite.service';
import { sendSuccess } from '../../utils/response';

export async function getInvite(req: Request, res: Response): Promise<void> {
  const invite = await service.getInvite(req.params.token);
  sendSuccess(res, invite);
}

export async function acceptInvite(req: Request, res: Response): Promise<void> {
  const result = await service.acceptInvite(req.user!.id, req.params.token, req.body);
  sendSuccess(res, result);
}
