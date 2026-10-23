import { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response';
import * as service from './redirect.service';

export async function list(req: Request, res: Response): Promise<void> {
  const result = await service.listRedirects({
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
    search: req.query.search as string | undefined,
  });
  sendSuccess(res, result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const redirect = await service.createRedirect(req.user!.id, {
    fromPath: req.body.fromPath,
    toPath: req.body.toPath,
    statusCode: req.body.statusCode,
    note: req.body.note,
  });
  sendSuccess(res, { redirect }, 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  const redirect = await service.updateRedirect(req.user!.id, req.params.id, {
    toPath: req.body.toPath,
    statusCode: req.body.statusCode,
    note: req.body.note,
  });
  sendSuccess(res, { redirect });
}

export async function remove(req: Request, res: Response): Promise<void> {
  await service.deleteRedirect(req.user!.id, req.params.id);
  sendSuccess(res, { ok: true });
}

/** Public map consumed by the storefront middleware to issue real 301/302s. */
export async function map(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getRedirectMap());
}
