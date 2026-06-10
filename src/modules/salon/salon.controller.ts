import { Request, Response } from 'express';
import * as service from './salon.service';
import { sendSuccess } from '../../utils/response';

export async function search(req: Request, res: Response): Promise<void> {
  const { name, lng, lat, radius } = req.query as unknown as {
    name?: string;
    lng?: number;
    lat?: number;
    radius?: number;
  };
  const salons = await service.searchSalons({ name, lng, lat, radius });
  sendSuccess(res, { salons });
}

export async function createSalon(req: Request, res: Response): Promise<void> {
  const salon = await service.createOwnSalon(req.user!.id, req.body);
  sendSuccess(res, { salon }, 201);
}

export async function createInvite(req: Request, res: Response): Promise<void> {
  const { salon, invite, link } = await service.createSalonInvite(req.user!.id, req.body);
  sendSuccess(
    res,
    {
      salon: { id: String(salon._id), status: salon.status },
      invite: { token: invite.token, status: invite.status, expiresAt: invite.expiresAt },
      link,
    },
    201,
  );
}

export async function listOwnerSalons(req: Request, res: Response): Promise<void> {
  const salons = await service.listOwnerSalons(req.user!.id);
  sendSuccess(res, { salons });
}

export async function listSalonStylists(req: Request, res: Response): Promise<void> {
  const status = req.query.status as 'pending' | 'active' | 'rejected' | undefined;
  const stylists = await service.listSalonStylists(req.params.salonId, status);
  sendSuccess(res, { stylists });
}

export async function approveStylist(req: Request, res: Response): Promise<void> {
  const { salonId, stylistId } = req.params;
  const link = await service.approveStylist(salonId, stylistId);
  sendSuccess(res, { membership: { stylistId, status: link.status } });
}

export async function rejectStylist(req: Request, res: Response): Promise<void> {
  const { salonId, stylistId } = req.params;
  const link = await service.rejectStylist(salonId, stylistId);
  sendSuccess(res, { membership: { stylistId, status: link.status } });
}
