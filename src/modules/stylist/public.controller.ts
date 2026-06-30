import { Request, Response } from 'express';
import * as service from './public.service';
import { sendSuccess } from '../../utils/response';

export async function search(req: Request, res: Response): Promise<void> {
  const { serviceId, categoryId, name, province, city, lng, lat, radius, gender, date } =
    req.query as unknown as {
      serviceId?: string;
      categoryId?: string;
      name?: string;
      province?: string;
      city?: string;
      lng?: number;
      lat?: number;
      radius?: number;
      gender?: 'women' | 'men';
      date?: string;
    };
  const stylists = await service.searchStylists({
    serviceId,
    categoryId,
    name,
    province,
    city,
    lng,
    lat,
    radius,
    gender,
    date,
  });
  sendSuccess(res, { stylists });
}

export async function profile(req: Request, res: Response): Promise<void> {
  const stylist = await service.getStylistProfile(req.params.id);
  sendSuccess(res, { stylist });
}

/** Cancellation policy (with per-service breakdown) for a booking with this stylist. */
export async function cancellationPolicy(req: Request, res: Response): Promise<void> {
  const { serviceIds, salonId } = req.query as unknown as {
    serviceIds?: string | string[];
    salonId?: string;
  };
  const ids = Array.isArray(serviceIds) ? serviceIds : serviceIds ? [serviceIds] : [];
  const result = await service.getStylistBookingPolicyBreakdown(req.params.id, ids, salonId ?? null);
  // `policy` kept for back-compat; `services`/`uniform` drive the per-service modal.
  sendSuccess(res, result);
}

export async function featured(_req: Request, res: Response): Promise<void> {
  const stylists = await service.getFeaturedStylists();
  sendSuccess(res, { stylists });
}

export async function home(req: Request, res: Response): Promise<void> {
  const { limit } = req.query as unknown as { limit?: number };
  const stylists = await service.getHomeStylists(limit);
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
