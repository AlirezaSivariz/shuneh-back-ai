import { Request, Response } from 'express';
import { sendSuccess } from '../../utils/response';
import * as service from './ticket.service';

export async function create(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const role = req.user!.roles.includes('stylist') ? 'stylist' : 'customer';
  const result = await service.createTicket(userId, role, req.body);
  sendSuccess(res, result, 201);
}

export async function listMy(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = await service.listMyTickets(userId, {
    status: req.query.status as string | undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  sendSuccess(res, result);
}

export async function getMy(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = await service.getMyTicket(userId, req.params.id);
  sendSuccess(res, result);
}

export async function addMessage(req: Request, res: Response): Promise<void> {
  const userId = req.user!.id;
  const result = await service.addMessage(userId, req.params.id, req.body);
  sendSuccess(res, result, 201);
}

export async function listAll(req: Request, res: Response): Promise<void> {
  const result = await service.listAllTickets({
    status: req.query.status as string | undefined,
    role: req.query.role as string | undefined,
    page: req.query.page ? Number(req.query.page) : undefined,
    limit: req.query.limit ? Number(req.query.limit) : undefined,
  });
  sendSuccess(res, result);
}

export async function getDetail(req: Request, res: Response): Promise<void> {
  const result = await service.getTicketDetail(req.params.id);
  sendSuccess(res, result);
}

export async function updateStatus(req: Request, res: Response): Promise<void> {
  const result = await service.updateTicketStatus(req.params.id, req.body.status);
  sendSuccess(res, result);
}

export async function close(req: Request, res: Response): Promise<void> {
  const adminId = req.user!.id;
  const result = await service.closeTicket(req.params.id, adminId);
  sendSuccess(res, result);
}

export async function adminReply(req: Request, res: Response): Promise<void> {
  const adminId = req.user!.id;
  const result = await service.adminAddMessage(adminId, req.params.id, req.body);
  sendSuccess(res, result, 201);
}
