import { Request, Response } from 'express';
import * as service from './public.service';
import { sendSuccess } from '../../utils/response';

export async function search(req: Request, res: Response): Promise<void> {
  const { serviceId, categoryId, name, lng, lat, radius, gender } = req.query as unknown as {
    serviceId?: string;
    categoryId?: string;
    name?: string;
    lng?: number;
    lat?: number;
    radius?: number;
    gender?: 'women' | 'men' | 'unisex';
  };
  const stylists = await service.searchStylists({
    serviceId,
    categoryId,
    name,
    lng,
    lat,
    radius,
    gender,
  });
  sendSuccess(res, { stylists });
}

export async function profile(req: Request, res: Response): Promise<void> {
  const stylist = await service.getStylistProfile(req.params.id);
  sendSuccess(res, { stylist });
}

export async function featured(_req: Request, res: Response): Promise<void> {
  const stylists = await service.getFeaturedStylists();
  sendSuccess(res, { stylists });
}

export async function availability(req: Request, res: Response): Promise<void> {
  const { date, serviceIds, excludeReservationId } = req.query as unknown as {
    date: string;
    serviceIds: string[];
    excludeReservationId?: string;
  };
  const result = await service.getAvailability(req.params.id, date, serviceIds, excludeReservationId);
  sendSuccess(res, result);
}

export async function availableDays(req: Request, res: Response): Promise<void> {
  const { from, to, serviceIds } = req.query as unknown as {
    from: string;
    to: string;
    serviceIds: string[];
  };
  const result = await service.getAvailableDays(req.params.id, from, to, serviceIds);
  sendSuccess(res, result);
}
