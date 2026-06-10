import { Request, Response } from 'express';
import * as service from './onboarding.service';
import { sendSuccess } from '../../utils/response';
import { Role } from '../../models/User';

export async function setRoles(req: Request, res: Response): Promise<void> {
  const roles = await service.setRoles(req.user!.id, req.body.roles as Role[]);
  sendSuccess(res, { roles });
}

export async function getState(req: Request, res: Response): Promise<void> {
  const state = await service.getOnboardingState(req.user!.id);
  sendSuccess(res, state);
}

export async function updatePersonal(req: Request, res: Response): Promise<void> {
  await service.updatePersonal(req.user!.id, req.body);
  const state = await service.getOnboardingState(req.user!.id);
  sendSuccess(res, state);
}
