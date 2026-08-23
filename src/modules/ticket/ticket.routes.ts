import { Router } from 'express';
import * as controller from './ticket.controller';
import { validate } from '../../middlewares/validate';
import { authenticate, authorize } from '../../middlewares/auth';
import { requireAdmin } from '../../middlewares/requireAdmin';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createTicketSchema,
  ticketIdParamsSchema,
  addMessageSchema,
  listTicketsSchema,
  adminListTicketsSchema,
  updateTicketStatusSchema,
} from './ticket.validators';

export function createCustomerTicketRoutes(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/', validate(listTicketsSchema), asyncHandler(controller.listMy));
  router.post('/', validate(createTicketSchema), asyncHandler(controller.create));
  router.get('/:id', validate(ticketIdParamsSchema), asyncHandler(controller.getMy));
  router.post('/:id/messages', validate(addMessageSchema), asyncHandler(controller.addMessage));
  return router;
}

export function createStylistTicketRoutes(): Router {
  const router = Router();
  router.use(authenticate, authorize('stylist'));
  router.get('/', validate(listTicketsSchema), asyncHandler(controller.listMy));
  router.post('/', validate(createTicketSchema), asyncHandler(controller.create));
  router.get('/:id', validate(ticketIdParamsSchema), asyncHandler(controller.getMy));
  router.post('/:id/messages', validate(addMessageSchema), asyncHandler(controller.addMessage));
  return router;
}

export function createAdminTicketRoutes(): Router {
  const router = Router();
  router.use(authenticate, requireAdmin);
  router.get('/', validate(adminListTicketsSchema), asyncHandler(controller.listAll));
  router.get('/:id', validate(ticketIdParamsSchema), asyncHandler(controller.getDetail));
  router.patch('/:id/status', validate(updateTicketStatusSchema), asyncHandler(controller.updateStatus));
  router.post('/:id/messages', validate(addMessageSchema), asyncHandler(controller.adminReply));
  router.patch('/:id/close', validate(ticketIdParamsSchema), asyncHandler(controller.close));
  return router;
}
