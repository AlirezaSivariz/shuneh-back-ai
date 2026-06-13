import { Request, Response } from 'express';
import * as service from './reservation.customer.service';
import * as discountService from '../discount/discount.service';
import { sendSuccess } from '../../utils/response';

export async function create(req: Request, res: Response): Promise<void> {
  const reservation = await service.createReservation(req.user!.id, req.body);
  sendSuccess(res, { reservation }, 201);
}

/** Preview/validate a discount code for a prospective booking (no writes). */
export async function validateDiscount(req: Request, res: Response): Promise<void> {
  const { stylistId, code, serviceIds, date, startTime } = req.body;
  const result = await discountService.previewDiscount(stylistId, {
    code,
    serviceIds,
    date,
    startTime,
  });
  sendSuccess(res, result);
}

/** Quick-rebook suggestions from the authenticated customer's own history. */
export async function quickRebook(req: Request, res: Response): Promise<void> {
  const result = await service.getQuickRebookSuggestions(req.user!.id);
  sendSuccess(res, result);
}

export async function list(req: Request, res: Response): Promise<void> {
  const filter = req.query.filter as 'upcoming' | 'past' | undefined;
  const reservations = await service.listCustomerReservations(req.user!.id, filter);
  sendSuccess(res, { reservations });
}

export async function detail(req: Request, res: Response): Promise<void> {
  const reservation = await service.getReservation(req.user!.id, req.params.id);
  sendSuccess(res, { reservation });
}

export async function cancel(req: Request, res: Response): Promise<void> {
  const reservation = await service.cancelReservation(req.user!.id, req.params.id);
  sendSuccess(res, { reservation });
}

export async function stylistList(req: Request, res: Response): Promise<void> {
  const filter = req.query.filter as 'upcoming' | 'past' | undefined;
  const reservations = await service.listStylistReservations(req.user!.id, filter);
  sendSuccess(res, { reservations });
}

export async function stylistCancel(req: Request, res: Response): Promise<void> {
  const reservation = await service.cancelByStylist(
    req.user!.id,
    req.params.id,
    req.body?.reason,
  );
  sendSuccess(res, { reservation });
}
