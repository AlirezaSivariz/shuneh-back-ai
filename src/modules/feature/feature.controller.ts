import { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response';
import * as service from './feature.service';
import { FeatureKey } from '../../models/UserFeatureOverride';

export async function listOverrides(req: Request, res: Response): Promise<void> {
  const result = await service.listAllOverrides({
    userId: req.query.userId as string | undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  sendSuccess(res, result);
}

export async function getOverridesForUser(req: Request, res: Response): Promise<void> {
  const result = await service.getAllOverridesForUser(req.params.userId);
  sendSuccess(res, result);
}

export async function createOverride(req: Request, res: Response): Promise<void> {
  const adminId = req.user!.id;
  await service.setFeatureOverride(adminId, req.body.userId, req.body.featureKey as FeatureKey, req.body.enabled);
  sendSuccess(res, { ok: true }, 201);
}

export async function removeOverride(req: Request, res: Response): Promise<void> {
  await service.removeFeatureOverride(req.params.userId, req.params.featureKey as FeatureKey);
  sendSuccess(res, { ok: true });
}

export async function getMyFeatures(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = await service.getAllOverridesForUser(userId);
  sendSuccess(res, result);
}
