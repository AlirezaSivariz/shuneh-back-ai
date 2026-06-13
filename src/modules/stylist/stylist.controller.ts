import { Request, Response } from 'express';
import * as service from './stylist.service';
import { sendSuccess } from '../../utils/response';

export async function setServices(req: Request, res: Response): Promise<void> {
  const services = await service.setServices(req.user!.id, req.body.items);
  sendSuccess(res, { services });
}

// ── Post-onboarding service management ──

export async function listServices(req: Request, res: Response): Promise<void> {
  const result = await service.listStylistServices(req.user!.id);
  sendSuccess(res, result);
}

export async function replaceServices(req: Request, res: Response): Promise<void> {
  const result = await service.replaceStylistServices(req.user!.id, req.body.items);
  sendSuccess(res, result);
}

export async function addService(req: Request, res: Response): Promise<void> {
  const result = await service.addStylistService(req.user!.id, req.params.serviceId, req.body);
  sendSuccess(res, result, 201);
}

export async function updateService(req: Request, res: Response): Promise<void> {
  const result = await service.updateStylistService(req.user!.id, req.params.serviceId, req.body);
  sendSuccess(res, result);
}

export async function removeService(req: Request, res: Response): Promise<void> {
  const result = await service.removeStylistService(req.user!.id, req.params.serviceId);
  sendSuccess(res, result);
}

// ── Custom (stylist-private) services ──

export async function createCustomService(req: Request, res: Response): Promise<void> {
  const result = await service.createCustomService(req.user!.id, req.body);
  sendSuccess(res, result, 201);
}

export async function updateCustomService(req: Request, res: Response): Promise<void> {
  const result = await service.updateCustomService(req.user!.id, req.params.serviceId, req.body);
  sendSuccess(res, result);
}

export async function deleteCustomService(req: Request, res: Response): Promise<void> {
  const result = await service.deleteCustomService(req.user!.id, req.params.serviceId);
  sendSuccess(res, result);
}

export async function setWorkplaceType(req: Request, res: Response): Promise<void> {
  const profile = await service.setWorkplaceType(req.user!.id, req.body.type);
  sendSuccess(res, { workplaceType: profile.workplaceType, onboardingStep: profile.onboardingStep });
}

export async function setFreelance(req: Request, res: Response): Promise<void> {
  const profile = await service.setFreelance(req.user!.id, req.body);
  sendSuccess(res, { freelance: profile.freelance, onboardingStep: profile.onboardingStep });
}

export async function joinSalon(req: Request, res: Response): Promise<void> {
  const link = await service.joinSalon(req.user!.id, req.body.salonId);
  sendSuccess(
    res,
    { membership: { salonId: String(link.salonId), status: link.status } },
    201,
  );
}

export async function listSalons(req: Request, res: Response): Promise<void> {
  const salons = await service.listStylistSalons(req.user!.id);
  sendSuccess(res, { salons });
}

export async function leaveSalon(req: Request, res: Response): Promise<void> {
  const force = req.query.force === 'true' || req.body?.force === true;
  const result = await service.leaveSalon(req.user!.id, req.params.salonId, force);
  sendSuccess(res, result);
}

export async function setAvailabilityStatus(req: Request, res: Response): Promise<void> {
  const result = await service.setAcceptingReservations(
    req.user!.id,
    req.body.isAcceptingReservations,
  );
  sendSuccess(res, result);
}

export async function setWorkingHours(req: Request, res: Response): Promise<void> {
  const result = await service.setWorkingHours(req.user!.id, req.body.entries);
  sendSuccess(res, result);
}

export async function getWorkingHours(req: Request, res: Response): Promise<void> {
  const result = await service.getWorkingHours(req.user!.id);
  sendSuccess(res, result);
}

export async function updateWorkingHour(req: Request, res: Response): Promise<void> {
  const result = await service.updateWorkingHour(req.user!.id, req.params.id, req.body);
  sendSuccess(res, result);
}

export async function deleteWorkingHour(req: Request, res: Response): Promise<void> {
  const result = await service.deleteWorkingHour(req.user!.id, req.params.id);
  sendSuccess(res, result);
}
