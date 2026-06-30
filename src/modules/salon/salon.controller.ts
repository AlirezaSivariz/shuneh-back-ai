import { Request, Response } from 'express';
import * as service from './salon.service';
import { sendSuccess } from '../../utils/response';

export async function search(req: Request, res: Response): Promise<void> {
  const { name, province, city, lng, lat, radius, gender } = req.query as unknown as {
    name?: string;
    province?: string;
    city?: string;
    lng?: number;
    lat?: number;
    radius?: number;
    gender?: 'women' | 'men';
  };
  const salons = await service.searchSalons({ name, province, city, lng, lat, radius, gender });
  sendSuccess(res, { salons });
}

/** Public salon detail + its bookable stylists (for the customer to book). */
export async function salonDetail(req: Request, res: Response): Promise<void> {
  const result = await service.getSalonDetail(req.params.id);
  sendSuccess(res, result);
}

export async function createSalon(req: Request, res: Response): Promise<void> {
  const { salon, onboardingStep } = await service.createOwnSalon(req.user!.id, req.body);
  sendSuccess(res, { salon, onboardingStep }, 201);
}

export async function byOwnerPhone(req: Request, res: Response): Promise<void> {
  const { phone } = req.query as unknown as { phone: string };
  const result = await service.findSalonsByOwnerPhone(phone);
  sendSuccess(res, result);
}

export async function createInvite(req: Request, res: Response): Promise<void> {
  const { salon, invite, inviteUrl, onboardingStep } = await service.createSalonInvite(
    req.user!.id,
    req.body,
  );
  sendSuccess(
    res,
    {
      salon: { id: String(salon._id), status: salon.status },
      invite: { token: invite.token, status: invite.status, expiresAt: invite.expiresAt },
      inviteUrl,
      link: inviteUrl, // backward-compatible alias
      onboardingStep,
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

export async function inviteStylist(req: Request, res: Response): Promise<void> {
  // res.locals.salon was loaded + ownership-verified by requireSalonOwner.
  const result = await service.inviteStylistToSalon(res.locals.salon, req.body.stylistId);
  sendSuccess(res, { membership: result }, 201);
}

export async function searchStylistsForInvite(req: Request, res: Response): Promise<void> {
  const { q } = req.query as unknown as { q: string };
  const stylists = await service.searchStylistsForInvite(q);
  sendSuccess(res, { stylists });
}

export async function approveStylist(req: Request, res: Response): Promise<void> {
  const { salonId, stylistId } = req.params;
  const link = await service.approveStylist(salonId, stylistId);
  sendSuccess(res, { membership: { stylistId, status: link.status } });
}

export async function rejectStylist(req: Request, res: Response): Promise<void> {
  const { salonId, stylistId } = req.params;
  const { link, affectedUpcomingReservations } = await service.rejectStylist(salonId, stylistId);
  sendSuccess(res, {
    membership: { stylistId, status: link.status },
    // Warning only — these reservations are NOT auto-cancelled.
    warning:
      affectedUpcomingReservations > 0
        ? {
            code: 'UPCOMING_RESERVATIONS_AFFECTED',
            affectedUpcomingReservations,
            message: `این متخصص ${affectedUpcomingReservations} نوبت آینده در این سالن دارد که لغو نشده‌اند.`,
          }
        : null,
  });
}

export async function updateSalon(req: Request, res: Response): Promise<void> {
  const salon = await service.updateSalon(req.params.salonId, req.body);
  sendSuccess(res, {
    salon: {
      id: String(salon._id),
      name: salon.name,
      description: salon.description,
      address: salon.address,
      province: salon.province ?? null,
      city: salon.city ?? null,
      location: salon.location,
      status: salon.status,
      serviceGender: salon.serviceGender,
      openingHours: salon.openingHours,
      cancellationPolicy: salon.cancellationPolicy ?? null,
    },
  });
}
