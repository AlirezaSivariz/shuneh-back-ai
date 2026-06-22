import { Request, Response } from 'express';
import * as service from './admin.service';
import * as stylistService from '../stylist/stylist.service';
import { MESSAGE_TEMPLATES } from '../message/message.service';
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
  sendSuccess(res, await service.approveReview(req.user!.id, req.params.id, req.body?.message));
}

export async function rejectReview(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await service.rejectReview(req.user!.id, req.params.id, req.body?.reason, req.body?.message),
  );
}

// ── Messages + image moderation ──
export async function sendMessage(req: Request, res: Response): Promise<void> {
  const result = await service.sendMessageToUser(req.user!.id, {
    recipientId: req.body.recipientId,
    title: req.body.title,
    body: req.body.body,
    relatedType: req.body.relatedType,
  });
  sendSuccess(res, result, 201);
}

export async function messageTemplates(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, { templates: MESSAGE_TEMPLATES });
}

export async function deleteProfilePhoto(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.deleteUserProfilePhoto(req.user!.id, req.params.id, req.body?.message));
}

export async function deletePortfolioItem(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await service.deleteUserPortfolioItem(req.user!.id, req.params.id, req.params.imageId, req.body?.message),
  );
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
  sendSuccess(res, await service.approveForeign(req.user!.id, req.params.id, req.body?.message));
}

export async function rejectForeign(req: Request, res: Response): Promise<void> {
  sendSuccess(
    res,
    await service.rejectForeign(req.user!.id, req.params.id, req.body?.reason, req.body?.message),
  );
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
  sendSuccess(res, {
    verification: await service.verifyStylist(req.user!.id, req.params.id, req.body?.message),
  });
}

export async function rejectVerification(req: Request, res: Response): Promise<void> {
  const result = await service.rejectVerification(
    req.user!.id,
    req.params.id,
    req.body?.reason,
    req.body?.message,
  );
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

// ── Service catalogue (categories + services) ──
export async function listCatalogue(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.listCatalogue());
}

export async function createCategory(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { category: await service.createCategory(req.user!.id, req.body) }, 201);
}

export async function updateCategory(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { category: await service.updateCategory(req.user!.id, req.params.id, req.body) });
}

export async function deleteCategory(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.deleteCategory(req.user!.id, req.params.id));
}

export async function createService(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { service: await service.createService(req.user!.id, req.body) }, 201);
}

export async function updateService(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { service: await service.updateService(req.user!.id, req.params.id, req.body) });
}

export async function deleteService(req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.deleteService(req.user!.id, req.params.id));
}

// ── Salon management ──
export async function getSalon(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { salon: await service.getSalonDetail(req.params.id) });
}

export async function updateSalon(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { salon: await service.adminUpdateSalon(req.user!.id, req.params.id, req.body) });
}

export async function setSalonStatus(req: Request, res: Response): Promise<void> {
  sendSuccess(res, { salon: await service.setSalonStatus(req.user!.id, req.params.id, req.body.status) });
}

// ── Reports & audit ──
export async function reports(_req: Request, res: Response): Promise<void> {
  sendSuccess(res, await service.getReports());
}

export async function auditLogs(req: Request, res: Response): Promise<void> {
  const q = req.query as Record<string, string>;
  sendSuccess(res, await service.listAuditLogs({ page: Number(q.page), limit: Number(q.limit) }));
}
