import { Request, Response } from 'express';
import * as service from './blog.service';
import { sendSuccess } from '../../utils/response';

// ─────────────────────────────── Public ───────────────────────────────
export async function list(req: Request, res: Response): Promise<void> {
  const page = req.query.page ? Number(req.query.page) : 1;
  sendSuccess(res, await service.listPublished(page));
}

export async function getBySlug(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { post: await service.getPublishedBySlug(req.params.slug) });
}

// ──────────────────────────────── Admin ───────────────────────────────
export async function adminList(req: Request, res: Response): Promise<void> {
  const page = req.query.page ? Number(req.query.page) : 1;
  sendSuccess(res, await service.adminList(page));
}

export async function adminGet(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { post: await service.adminGet(req.params.id) });
}

export async function create(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { post: await service.create(req.user!.id, req.body) }, 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { post: await service.update(req.user!.id, req.params.id, req.body) });
}

export async function remove(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.remove(req.user!.id, req.params.id));
}

export async function uploadCover(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.saveCover(req.user!.id, req.file));
}
