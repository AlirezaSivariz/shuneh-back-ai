import { Request, Response } from 'express';
import * as service from './admin.service';
import { sendSuccess } from '../../utils/response';
import { Role } from '../../models/User';
import { ReservationStatus } from '../../models/Reservation';

// ── Users ──
export async function listUsers(req: Request, res: Response): Promise<void> {
  const { role, search, page, limit } = req.query as Record<string, string>;
  const result = await service.listUsers({
    role: role as Role | undefined,
    search,
    page: Number(page),
    limit: Number(limit),
  });
  sendSuccess(res, result);
}

export async function getUser(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getUser(req.params.id));
}

export async function setUserStatus(req: Request, res: Response): Promise<void> {
  const result = await service.setUserStatus(req.user!.id, req.params.id, req.body.isActive);
  sendSuccess(res, result);
}

// ── Reservations ──
export async function listReservations(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  const result = await service.listReservations({
    from: q.from,
    to: q.to,
    status: q.status as ReservationStatus | undefined,
    stylistId: q.stylistId,
    customerId: q.customerId,
    salonId: q.salonId,
    page: Number(q.page),
    limit: Number(q.limit),
  });
  sendSuccess(res, result);
}

export async function getReservation(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getReservation(req.params.id));
}

export async function cancelReservation(req: Request, res: Response): Promise<void> {
  const result = await service.cancelReservation(req.user!.id, req.params.id, req.body?.reason);
  sendSuccess(res, { reservation: result });
}

// ── Salons & stylists ──
export async function listSalons(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  sendSuccess(
    res,
    await service.listSalons({ search: q.search, status: q.status, page: Number(q.page), limit: Number(q.limit) }),
  );
}

export async function listStylists(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  sendSuccess(
    res,
    await service.listStylists({ search: q.search, status: q.status, page: Number(q.page), limit: Number(q.limit) }),
  );
}

export async function promote(req: Request, res: Response): Promise<void> {
  const { until, tier } = req.body as { until: Date; tier?: number };
  const result = await service.promoteStylist(req.user!.id, req.params.id, until, tier);
  sendSuccess(res, { promotion: result });
}

export async function unpromote(req: Request, res: Response): Promise<void> {
  const result = await service.unpromoteStylist(req.user!.id, req.params.id);
  sendSuccess(res, { promotion: result });
}

// ── Reports & audit ──
export async function reports(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getReports());
}

export async function auditLogs(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  sendSuccess(res, await service.listAuditLogs({ page: Number(q.page), limit: Number(q.limit) }));
}
