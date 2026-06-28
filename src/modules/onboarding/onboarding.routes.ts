import { Router } from 'express';
import * as controller from './onboarding.controller';
import * as reportsController from '../reports/reports.controller';
import * as reservationController from '../reservation/reservation.customer.controller';
import * as mediaController from '../media/media.controller';
import * as messageController from '../message/message.controller';
import * as walletController from '../wallet/wallet.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { createUploader } from '../../middlewares/upload';
import { setRolesSchema, personalSchema, nameEditSchema } from './onboarding.validators';
import { reportRangeSchema } from '../reports/reports.validators';
import { topupSchema, walletTxListSchema } from '../wallet/wallet.validators';

// Routes under /onboarding
export const onboardingRouter = Router();
onboardingRouter.use(authenticate);
onboardingRouter.post('/role', validate(setRolesSchema), asyncHandler(controller.setRoles));
onboardingRouter.get('/state', asyncHandler(controller.getState));

// Routes under /me
export const meRouter = Router();
meRouter.use(authenticate);
// Multi-role state: roles + per-role status, for navigation/panel switching.
meRouter.get('/state', asyncHandler(controller.getUserState));
// Pending owner-invites by phone (discoverable without opening the magic link).
meRouter.get('/pending-invites', asyncHandler(controller.getPendingInvites));
meRouter.patch('/personal', validate(personalSchema), asyncHandler(controller.updatePersonal));
// Reviewed display-name edit: request (pending until an admin approves) + read own pending.
meRouter.get('/profile/name', asyncHandler(controller.getMyNameEdit));
meRouter.post('/profile/name', validate(nameEditSchema), asyncHandler(controller.requestNameEdit));
// Profile photo for ANY authenticated user (customer/stylist/owner) — multipart 'photo'.
const profilePhotoUploader = createUploader('profile');
meRouter.post(
  '/profile-photo',
  profilePhotoUploader.single('photo'),
  asyncHandler(mediaController.uploadProfilePhoto),
);
// ── Wallet (customer; own wallet only) ──
meRouter.get('/wallet', asyncHandler(walletController.getWallet));
meRouter.get('/wallet/transactions', validate(walletTxListSchema), asyncHandler(walletController.listTransactions));
meRouter.post('/wallet/topup', validate(topupSchema), asyncHandler(walletController.topup));

// Customer activity/spending report (scoped to the authenticated user).
meRouter.get('/reports', validate(reportRangeSchema), asyncHandler(reportsController.customerReport));
// Quick-rebook suggestions from the customer's own completed history.
meRouter.get('/quick-rebook', asyncHandler(reservationController.quickRebook));
// In-app messages from support (one-way: admin → user).
meRouter.get('/messages', asyncHandler(messageController.listMine));
meRouter.get('/messages/unread-count', asyncHandler(messageController.unreadCount));
meRouter.patch('/messages/:id/read', asyncHandler(messageController.markRead));
