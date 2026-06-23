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
  listVerificationsSchema,
  rejectVerificationSchema,
  stylistDocumentSchema,
  listForeignApprovalsSchema,
  rejectForeignSchema,
  listSmsLogsSchema,
  listReviewsSchema,
  rejectReviewSchema,
  idWithMessageSchema,
  sendMessageSchema,
  deleteImageSchema,
  deletePortfolioImageSchema,
  createCategorySchema,
  updateCategorySchema,
  createServiceSchema,
  updateServiceSchema,
  adminUpdateSalonSchema,
  setSalonStatusSchema,
  adminWalletAdjustSchema,
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
adminRouter.get('/verifications', validate(listVerificationsSchema), asyncHandler(controller.listVerifications));
adminRouter.get('/foreign-approvals', validate(listForeignApprovalsSchema), asyncHandler(controller.listForeignApprovals));
// Stream a stylist's national-ID image for review (admin-only; private).
adminRouter.get('/stylists/:id/documents/:side', validate(stylistDocumentSchema), asyncHandler(controller.getStylistDocument));
adminRouter.get('/audit-logs', validate(paginationSchema), asyncHandler(controller.auditLogs));
adminRouter.get('/sms-logs', validate(listSmsLogsSchema), asyncHandler(controller.smsLogs));
adminRouter.get('/reviews', validate(listReviewsSchema), asyncHandler(controller.listReviews));
adminRouter.get('/message-templates', asyncHandler(controller.messageTemplates));
// Service catalogue (categories + services) — read.
adminRouter.get('/catalogue', asyncHandler(controller.listCatalogue));
adminRouter.get('/salons/:id', validate(idParamsSchema), asyncHandler(controller.getSalon));

// ── Write (conservative; audited) ──
adminRouter.patch('/users/:id/status', validate(setUserStatusSchema), asyncHandler(controller.setUserStatus));
adminRouter.post('/messages', validate(sendMessageSchema), asyncHandler(controller.sendMessage));
adminRouter.delete('/users/:id/profile-photo', validate(deleteImageSchema), asyncHandler(controller.deleteProfilePhoto));
adminRouter.delete('/users/:id/portfolio/:imageId', validate(deletePortfolioImageSchema), asyncHandler(controller.deletePortfolioItem));
adminRouter.post('/reservations/:id/cancel', validate(cancelReservationSchema), asyncHandler(controller.cancelReservation));
adminRouter.post('/stylists/:id/promote', validate(promoteSchema), asyncHandler(controller.promote));
adminRouter.post('/stylists/:id/unpromote', validate(stylistIdParamsSchema), asyncHandler(controller.unpromote));
adminRouter.post('/stylists/:id/verify', validate(idWithMessageSchema), asyncHandler(controller.verifyStylist));
adminRouter.post('/stylists/:id/reject-verification', validate(rejectVerificationSchema), asyncHandler(controller.rejectVerification));
adminRouter.post('/users/:id/approve-foreign', validate(idWithMessageSchema), asyncHandler(controller.approveForeign));
adminRouter.post('/users/:id/reject-foreign', validate(rejectForeignSchema), asyncHandler(controller.rejectForeign));
adminRouter.post('/reviews/:id/approve', validate(idWithMessageSchema), asyncHandler(controller.approveReview));
adminRouter.post('/reviews/:id/reject', validate(rejectReviewSchema), asyncHandler(controller.rejectReview));

// ── Service catalogue management (audited) ──
adminRouter.post('/categories', validate(createCategorySchema), asyncHandler(controller.createCategory));
adminRouter.patch('/categories/:id', validate(updateCategorySchema), asyncHandler(controller.updateCategory));
adminRouter.delete('/categories/:id', validate(idParamsSchema), asyncHandler(controller.deleteCategory));
adminRouter.post('/services', validate(createServiceSchema), asyncHandler(controller.createService));
adminRouter.patch('/services/:id', validate(updateServiceSchema), asyncHandler(controller.updateService));
adminRouter.delete('/services/:id', validate(idParamsSchema), asyncHandler(controller.deleteService));

// ── Salon management (audited) ──
adminRouter.patch('/salons/:id', validate(adminUpdateSalonSchema), asyncHandler(controller.updateSalon));
adminRouter.patch('/salons/:id/status', validate(setSalonStatusSchema), asyncHandler(controller.setSalonStatus));

// ── Wallet manual adjust (audited) ──
adminRouter.post('/users/:id/wallet/adjust', validate(adminWalletAdjustSchema), asyncHandler(controller.adjustWallet));
