import { Request, Response } from 'express';
import * as service from './campaign.service';
import { sendSuccess } from '../../utils/response';

/** GET /stylist/sms-campaign/status — plan gate + limits for the current stylist. */
export async function status(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getStatus(req.user!.id));
}

/** GET /stylist/customers — the stylist's own past customers (paged/search). */
export async function customers(req: Request, res: Response): Promise<void> {
  const { search, page, limit } = req.query as Record<string, string>;
  sendSuccess(
    res,
    await service.listCustomers(req.user!.id, {
      search,
      page: Number(page),
      limit: Number(limit),
    }),
  );
}

/** POST /stylist/sms-campaign/send — blast one own code to chosen recipients. */
export async function send(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.sendCampaign(req.user!.id, req.body), 201);
}
