import { Request, Response } from 'express';
import * as service from './admin.service';
import * as stylistService from '../stylist/stylist.service';
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
  const result = await service.setUserStatus(
    req.user!.id,
    req.params.id,
    req.body.isActive,
    req.body?.reason,
  );
  sendSuccess(res, result);
}

// ── Review moderation ──
export async function listReviews(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  sendSuccess(
    res,
    await service.listReviews({
      status: q.status as 'pending' | 'approved' | 'rejected' | 'all' | undefined,
      page: Number(q.page),
      limit: Number(q.limit),
    }),
  );
}

export async function approveReview(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.approveReview(req.user!.id, req.params.id));
}

export async function rejectReview(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.rejectReview(req.user!.id, req.params.id, req.body?.reason));
}

export async function smsLogs(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  sendSuccess(
    res,
    await service.listSmsLogs({
      event: q.event,
      success: q.success as 'true' | 'false' | undefined,
      page: Number(q.page),
      limit: Number(q.limit),
    }),
  );
}

// ── Foreign-national approvals ──
export async function listForeignApprovals(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  sendSuccess(
    res,
    await service.listForeignApprovals({
      status: q.status as 'pending' | 'approved' | 'rejected' | 'all' | undefined,
      page: Number(q.page),
      limit: Number(q.limit),
    }),
  );
}

export async function approveForeign(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.approveForeign(req.user!.id, req.params.id));
}

export async function rejectForeign(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.rejectForeign(req.user!.id, req.params.id, req.body?.reason));
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

// ── Verification ──
export async function listVerifications(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  sendSuccess(
    res,
    await service.listVerifications({
      status: q.status as 'pending' | 'verified' | 'rejected' | 'incomplete' | undefined,
      page: Number(q.page),
      limit: Number(q.limit),
    }),
  );
}

export async function verifyStylist(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { verification: await service.verifyStylist(req.user!.id, req.params.id) });
}

export async function rejectVerification(req: Request, res: Response): Promise<void> {
  const result = await service.rejectVerification(req.user!.id, req.params.id, req.body?.reason);
  sendSuccess(res, { verification: result });
}

/** Stream a stylist's national-ID image for review (admin-only; private). */
export async function getStylistDocument(req: Request, res: Response): Promise<void> {
  const side = req.params.side as 'front' | 'back';
  const { data, contentType } = await stylistService.resolveVerificationDocument(
    req.params.id,
    side,
  );
  res.setHeader('Content-Type', contentType);
  res.setHeader('Cache-Control', 'private, no-store');
  res.send(data);
}

// ── Reports & audit ──
export async function reports(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getReports());
}

export async function auditLogs(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  sendSuccess(res, await service.listAuditLogs({ page: Number(q.page), limit: Number(q.limit) }));
}
