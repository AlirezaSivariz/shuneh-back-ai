import { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response';
import * as service from './chat.service';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await service.listConversations(req.user!.id);
  sendSuccess(res, { items: result });
}

export async function create(req: Request, res: Response): Promise<void> {
  const result = await service.getOrCreateConversation(req.user!.id, req.body.stylistId);
  sendSuccess(res, result, 201);
}

export async function messages(req: Request, res: Response): Promise<void> {
  const result = await service.listMessages(req.user!.id, req.params.id, {
    after: req.query.after as string | undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  sendSuccess(res, result);
}

export async function send(req: Request, res: Response): Promise<void> {
  const result = await service.sendMessage(req.user!.id, req.params.id, req.body.text);
  sendSuccess(res, result, 201);
}

export async function read(req: Request, res: Response): Promise<void> {
  const result = await service.markRead(req.user!.id, req.params.id);
  sendSuccess(res, result);
}

export async function unread(req: Request, res: Response): Promise<void> {
  const result = await service.getUnreadCount(req.user!.id);
  sendSuccess(res, result);
}
