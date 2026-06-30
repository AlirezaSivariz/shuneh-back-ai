import { Request, Response } from 'express';
import * as service from './onboarding.service';
import * as inviteService from '../invite/invite.service';
import { sendSuccess } from '../../utils/response';
import { Role } from '../../models/User';

/** Pending owner-invites addressed to the logged-in user's phone number. */
export async function getPendingInvites(req: Request, res: Response): Promise<void> {
  const invites = await inviteService.getPendingInvitesForUser(req.user!.id);
  sendSuccess(res, { invites });
}

export async function setRoles(req: Request, res: Response): Promise<void> {
  const roles = await service.setRoles(req.user!.id, req.body.roles as Role[]);
  // Return the stylist per-role state so the client knows where to go next.
  const stylist = await service.getStylistRoleState(req.user!.id);
  sendSuccess(res, { roles, stylist });
}

export async function getState(req: Request, res: Response): Promise<void> {
  const state = await service.getOnboardingState(req.user!.id);
  sendSuccess(res, state);
}

/** Multi-role user state for navigation (roles + per-role status). */
export async function getUserState(req: Request, res: Response): Promise<void> {
  const state = await service.getUserState(req.user!.id);
  sendSuccess(res, state);
}

export async function updatePersonal(req: Request, res: Response): Promise<void> {
  await service.updatePersonal(req.user!.id, req.body);
  const state = await service.getOnboardingState(req.user!.id);
  sendSuccess(res, state);
}

export async function requestNameEdit(req: Request, res: Response): Promise<void> {
  const edit = await service.requestNameEdit(req.user!.id, req.body.firstName, req.body.lastName);
  sendSuccess(res, { edit }, 201);
}

export async function getMyNameEdit(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { edit: await service.getMyNameEdit(req.user!.id) });
}

// ── Foreign-national passport image ──
export async function uploadPassport(req: Request, res: Response): Promise<void> {
  const result = await service.uploadPassportImage(req.user!.id, req.file);
  // Return the fresh state so the client reflects the new approval status.
  const state = await service.getOnboardingState(req.user!.id);
  sendSuccess(res, { ...result, state }, 201);
}

export async function streamOwnPassport(req: Request, res: Response): Promise<void> {
  const { data, contentType } = await service.resolveOwnPassport(req.user!.id);
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(data);
}
