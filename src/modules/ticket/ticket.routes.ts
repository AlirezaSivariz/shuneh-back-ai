import { Router } from 'express';
import * as controller from './ticket.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { requireAdmin } from '../../middlewares/requireAdmin';
import { asyncHandler } from '../../utils/asyncHandler';

export function createCustomerTicketRoutes(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/', asyncHandler(controller.listMy));
  router.post('/', asyncHandler(controller.create));
  router.get('/:id', asyncHandler(controller.getMy));
  router.post('/:id/messages', asyncHandler(controller.addMessage));
  return router;
}

export function createStylistTicketRoutes(): Router {
  const router = Router();
  router.use(authenticate, authorize('stylist'));
  router.get('/', asyncHandler(controller.listMy));
  router.post('/', asyncHandler(controller.create));
  router.get('/:id', asyncHandler(controller.getMy));
  router.post('/:id/messages', asyncHandler(controller.addMessage));
  return router;
}

export function createAdminTicketRoutes(): Router {
  const router = Router();
  router.use(authenticate, requireAdmin);
  router.get('/', asyncHandler(controller.listAll));
  router.get('/:id', asyncHandler(controller.getDetail));
  router.patch('/:id/status', asyncHandler(controller.updateStatus));
  router.post('/:id/messages', asyncHandler(controller.adminReply));
  router.patch('/:id/close', asyncHandler(controller.close));
  return router;
}
