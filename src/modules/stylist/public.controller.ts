import { Request, Response } from 'express';
import * as service from './public.service';
import { sendSuccess } from '../../utils/response';
import { validateUsernameFormat } from '../../utils/username';

export async function search(req: Request, res: Response): Promise<void> {
  const { serviceId, categoryId, name, province, city, lng, lat, radius, gender, date, page, limit } =
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
      page?: number;
      limit?: number;
    };
  const result = await service.searchStylistsPage(
    {
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
    },
    page,
    limit,
  );
  sendSuccess(res, result);
}

export async function profile(req: Request, res: Response): Promise<void> {
  const stylist = await service.getStylistProfile(req.params.id, req.user?.id);
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
  const { from, to, serviceIds, mode } = req.query as unknown as {
    from: string;
    to: string;
    serviceIds: string[];
    mode: 'any' | 'all';
  };
  const result = await service.getAvailableDays(req.params.id, from, to, serviceIds, mode);
  sendSuccess(res, result);
}

export async function checkUsername(req: Request, res: Response): Promise<void> {
  const raw = req.params.username.toLowerCase().trim();
  const formatError = validateUsernameFormat(raw);
  if (formatError) {
    sendSuccess(res, { available: false, reason: formatError });
    return;
  }
  const available = await service.isUsernameAvailable(raw);
  sendSuccess(res, { available });
}
