import { Router } from 'express';
import * as controller from './settlement.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { requireAdmin } from '../../middlewares/requireAdmin';
import { rateLimit } from '../../middlewares/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import { z } from 'zod';

const createSettlementSchema = {
  body: z.object({
    amount: z.number().min(1, 'مبلغ باید بیشتر از صفر باشد').optional(),
    depositReservationIds: z.array(z.string()).optional(),
  }).refine((data) => data.amount !== undefined || (data.depositReservationIds && data.depositReservationIds.length > 0), {
    message: 'باید مبلغ یا رزروهای انتخاب‌شده مشخص شود',
    path: ['amount'],
  }),
};

const updateSettlementSchema = {
  body: z.object({
    status: z.enum(['approved', 'rejected', 'paid'], {
      errorMap: () => ({ message: 'وضعیت نامعتبر است' }),
    }),
    adminNote: z.string().max(500).optional(),
  }),
  params: z.object({
    id: z.string().min(1),
  }),
};

const idParamsSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
};

/**
 * Stylist-facing settlement routes — the stylist can view balance,
 * get available reservations, create requests, and list their own requests.
 */
export function createStylistSettlementRoutes(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/balance', asyncHandler(controller.getBalance));
  router.get('/available-reservations', asyncHandler(controller.getSettlableReservations));
  router.post('/', validate(createSettlementSchema), asyncHandler(controller.create));
  router.get('/', asyncHandler(controller.list));

  return router;
}

/**
 * Admin settlement routes — view all requests and update status.
 */
export function createAdminSettlementRoutes(): Router {
  const router = Router();
  router.use(authenticate, requireAdmin, rateLimit({ windowMs: 60_000, max: 120, key: 'admin' }));

  router.get('/', asyncHandler(controller.adminList));
  router.patch('/:id', validate(updateSettlementSchema), asyncHandler(controller.adminUpdate));

  return router;
}
