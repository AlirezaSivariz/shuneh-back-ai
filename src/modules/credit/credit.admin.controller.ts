import { Request, Response } from 'express';
import * as service from './credit.service';
import { getCreditSettings, invalidateSettingsCache } from './credit.service';
import { sendSuccess } from '../../utils/response';
import { AuditLog } from '../../models/AuditLog';
import { Types } from 'mongoose';

export async function getSettings(_req: Request, res: Response): Promise<void> {
  const settings = await getCreditSettings();
  sendSuccess(res, {
    completedReservationCredit: settings.completedReservationCredit,
    fiveStarReviewCredit: settings.fiveStarReviewCredit,
    consecutiveCancelPenalty: settings.consecutiveCancelPenalty,
    consecutiveCancelThreshold: settings.consecutiveCancelThreshold,
    silverCreditPrice: settings.silverCreditPrice,
    goldCreditPrice: settings.goldCreditPrice,
    isEnabled: settings.isEnabled,
  });
}

export async function updateSettings(req: Request, res: Response): Promise<void> {
  const { CreditSetting } = await import('../../models/CreditSetting');
  const settings = await CreditSetting.findOneAndUpdate(
    {},
    { $set: { ...req.body, updatedBy: new Types.ObjectId(req.user!.id) } },
    { upsert: true, new: true },
  );
  invalidateSettingsCache();

  const changed = Object.keys(req.body).join(', ');
  await AuditLog.create({
    adminId: new Types.ObjectId(req.user!.id),
    action: 'credit_settings_update',
    targetType: 'credit_setting',
    targetId: String(settings._id),
    summary: { changed },
  });

  sendSuccess(res, settings);
}

export async function listUsers(req: Request, res: Response): Promise<void> {
  const { page, limit, search } = req.query as Record<string, string>;
  const result = await service.adminListUsers(
    Number(page) || 1,
    Number(limit) || 20,
    search,
  );
  sendSuccess(res, result);
}

export async function listUserHistory(req: Request, res: Response): Promise<void> {
  const { page, limit } = req.query as Record<string, string>;
  const result = await service.adminListUserTransactions(
    req.params.id,
    Number(page) || 1,
    Number(limit) || 20,
  );
  sendSuccess(res, result);
}

export async function adjustCredit(req: Request, res: Response): Promise<void> {
  const { amount, description } = req.body as { amount: number; description: string };
  const result = await service.adminAdjust(req.user!.id, req.params.id, { amount, description });

  await AuditLog.create({
    adminId: new Types.ObjectId(req.user!.id),
    action: 'credit_manual_adjust',
    targetType: 'user',
    targetId: req.params.id,
    summary: { amount, description },
  });

  sendSuccess(res, result);
}

export async function listAllTransactions(req: Request, res: Response): Promise<void> {
  const { page, limit } = req.query as Record<string, string>;
  const result = await service.adminListAllTransactions(
    Number(page) || 1,
    Number(limit) || 20,
  );
  sendSuccess(res, result);
}
