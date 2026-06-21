import { Request, Response } from 'express';
import * as service from './message.service';
import { sendSuccess } from '../../utils/response';

// ── User-facing ──
export async function listMine(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listForUser(req.user!.id));
}

export async function unreadCount(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { count: await service.unreadCount(req.user!.id) });
}

export async function markRead(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { message: await service.markRead(req.user!.id, req.params.id) });
}

// ── Admin-facing ──
export async function templates(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, { templates: service.MESSAGE_TEMPLATES });
}
