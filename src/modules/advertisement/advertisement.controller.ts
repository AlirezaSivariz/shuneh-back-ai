import { Request, Response } from 'express';
import * as service from './advertisement.service';
import { sendSuccess } from '../../utils/response';
import { AppError } from '../../utils/AppError';
import { storageProvider } from '../../utils/storage';
import { AdAudience } from '../../models/Advertisement';

/**
 * Resolve a stable viewer identity:
 *  - authenticated users are keyed by their user id (not client-controlled),
 *  - guests send a persistent UUID from localStorage (`viewerKey` / `?viewer=`),
 *  - if that is missing we fall back to the IP so frequency still applies.
 */
function viewerFromRequest(req: Request): service.ViewerContext {
  if (req.user) {
    return {
      viewerKey: `user:${req.user.id}`,
      userId: req.user.id,
      roles: req.user.roles,
    };
  }

  const raw =
    (typeof req.body?.viewerKey === 'string' && req.body.viewerKey) ||
    (typeof req.query?.viewer === 'string' && req.query.viewer) ||
    '';
  const cleaned = raw.trim().replace(/[^\w:.-]/g, '').slice(0, 100);

  return {
    viewerKey: cleaned ? `guest:${cleaned}` : `ip:${req.ip ?? 'unknown'}`,
  };
}

// ─────────────────────────────── public ────────────────────────────────

export async function next(req: Request, res: Response): Promise<void> {
  const ad = await service.pickNext(viewerFromRequest(req));
  sendSuccess(res, { ad: ad ? service.toPublic(ad) : null });
}

export async function impression(req: Request, res: Response): Promise<void> {
  const shown = await service.recordImpression(req.params.id, viewerFromRequest(req));
  sendSuccess(res, { shown });
}

export async function click(req: Request, res: Response): Promise<void> {
  await service.recordClick(req.params.id);
  sendSuccess(res, { ok: true });
}

// ──────────────────────────────── admin ────────────────────────────────

export async function adminList(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  const result = await service.listAdvertisements({
    search: q.search,
    audience: q.audience as AdAudience | undefined,
    isActive: q.isActive === undefined ? undefined : q.isActive === 'true',
    page: q.page ? Number(q.page) : undefined,
    limit: q.limit ? Number(q.limit) : undefined,
  });
  sendSuccess(res, result);
}

export async function create(req: Request, res: Response): Promise<void> {
  const advertisement = await service.createAdvertisement(req.user!.id, req.body);
  sendSuccess(res, { advertisement }, 201);
}

export async function update(req: Request, res: Response): Promise<void> {
  const advertisement = await service.updateAdvertisement(req.user!.id, req.params.id, req.body);
  sendSuccess(res, { advertisement });
}

export async function setStatus(req: Request, res: Response): Promise<void> {
  const advertisement = await service.setAdvertisementStatus(
    req.user!.id,
    req.params.id,
    req.body.isActive,
  );
  sendSuccess(res, { advertisement });
}

export async function remove(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.removeAdvertisement(req.user!.id, req.params.id));
}

/** Upload the promotional image; returns the storage key + public URL. */
export async function uploadImage(req: Request, res: Response): Promise<void> {
  if (!req.file) throw AppError.badRequest('تصویری ارسال نشده است', 'NO_FILE');
  const stored = await storageProvider.save(req.file, {
    ownerType: 'advertisement',
    ownerId: req.user!.id,
    kind: 'advertisement',
  });
  sendSuccess(res, { key: stored.path, url: storageProvider.getUrl(stored.path) }, 201);
}
