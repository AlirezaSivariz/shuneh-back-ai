import { Router } from 'express';
import * as controller from './admin.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { requireAdmin } from '../../middlewares/requireAdmin';
import { rateLimit } from '../../middlewares/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  idParamsSchema,
  listUsersSchema,
  setUserStatusSchema,
  listReservationsSchema,
  cancelReservationSchema,
  listSalonsSchema,
  listStylistsSchema,
  promoteSchema,
  stylistIdParamsSchema,
  paginationSchema,
} from './admin.validators';

/**
 * Admin (support) area. EVERY route is guarded by `authenticate` → `requireAdmin`
 * (role 'admin') and a rate limiter. Completely separate from user-facing routes.
 */
export const adminRouter = Router();
adminRouter.use(authenticate, requireAdmin, rateLimit({ windowMs: 60_000, max: 120, key: 'admin' }));

// ── Read ──
adminRouter.get('/reports', asyncHandler(controller.reports));
adminRouter.get('/users', validate(listUsersSchema), asyncHandler(controller.listUsers));
adminRouter.get('/users/:id', validate(idParamsSchema), asyncHandler(controller.getUser));
adminRouter.get('/reservations', validate(listReservationsSchema), asyncHandler(controller.listReservations));
adminRouter.get('/reservations/:id', validate(idParamsSchema), asyncHandler(controller.getReservation));
adminRouter.get('/salons', validate(listSalonsSchema), asyncHandler(controller.listSalons));
adminRouter.get('/stylists', validate(listStylistsSchema), asyncHandler(controller.listStylists));
adminRouter.get('/audit-logs', validate(paginationSchema), asyncHandler(controller.auditLogs));

// ── Write (conservative; audited) ──
adminRouter.patch('/users/:id/status', validate(setUserStatusSchema), asyncHandler(controller.setUserStatus));
adminRouter.post('/reservations/:id/cancel', validate(cancelReservationSchema), asyncHandler(controller.cancelReservation));
adminRouter.post('/stylists/:id/promote', validate(promoteSchema), asyncHandler(controller.promote));
adminRouter.post('/stylists/:id/unpromote', validate(stylistIdParamsSchema), asyncHandler(controller.unpromote));
