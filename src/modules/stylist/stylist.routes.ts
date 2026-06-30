import { Router } from 'express';
import * as controller from './stylist.controller';
import * as reservationController from '../reservation/reservation.customer.controller';
import { validate } from '../../middlewares/validate';
import { authenticate, authorize } from '../../middlewares/auth';
import { createUploader } from '../../middlewares/upload';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  listReservationsSchema,
  stylistCancelSchema,
  rescheduleSchema,
} from '../reservation/reservation.validators';
import * as reportsController from '../reports/reports.controller';
import { reportRangeSchema } from '../reports/reports.validators';
import * as discountController from '../discount/discount.controller';
import {
  createDiscountCodeSchema,
  updateDiscountCodeSchema,
  discountCodeIdParamsSchema,
} from '../discount/discount.validators';
import * as campaignController from '../campaign/campaign.controller';
import { customersQuerySchema, sendCampaignSchema } from '../campaign/campaign.validators';
import {
  setServicesSchema,
  replaceServicesSchema,
  stylistServiceBodySchema,
  stylistServiceIdParamsSchema,
  createCustomServiceSchema,
  updateCustomServiceSchema,
  workplaceTypeSchema,
  freelanceSchema,
  joinSalonSchema,
  leaveSalonSchema,
  availabilityStatusSchema,
  verificationSideSchema,
  workingHoursSchema,
  updateWorkingHourSchema,
  workingHourIdParamsSchema,
  inviteIdParamsSchema,
  salonRequestIdParamsSchema,
  salonRequestsQuerySchema,
  cancellationPolicySchema,
  servicePolicySchema,
  servicePolicyIdParamsSchema,
  payoutSchema,
} from './stylist.validators';

const router = Router();

// Every stylist onboarding route requires an authenticated stylist.
router.use(authenticate, authorize('stylist'));

// Step 2 — services (onboarding: full set, advances onboarding step).
router.post('/services', validate(setServicesSchema), asyncHandler(controller.setServices));

// Service management (post-onboarding; does NOT touch onboarding step).
router.get('/services', asyncHandler(controller.listServices));
router.put('/services', validate(replaceServicesSchema), asyncHandler(controller.replaceServices));

// Custom (stylist-private) services — registered BEFORE '/services/:serviceId'
// so that the literal 'custom' segment is never treated as a serviceId.
router.post(
  '/services/custom',
  validate(createCustomServiceSchema),
  asyncHandler(controller.createCustomService),
);
router.patch(
  '/services/custom/:serviceId',
  validate(updateCustomServiceSchema),
  asyncHandler(controller.updateCustomService),
);
router.delete(
  '/services/custom/:serviceId',
  validate(stylistServiceIdParamsSchema),
  asyncHandler(controller.deleteCustomService),
);

router.post(
  '/services/:serviceId',
  validate(stylistServiceBodySchema),
  asyncHandler(controller.addService),
);
router.patch(
  '/services/:serviceId',
  validate(stylistServiceBodySchema),
  asyncHandler(controller.updateService),
);
router.delete(
  '/services/:serviceId',
  validate(stylistServiceIdParamsSchema),
  asyncHandler(controller.removeService),
);

// Step 3 — workplace.
router.post('/workplace', validate(workplaceTypeSchema), asyncHandler(controller.setWorkplaceType));
router.post(
  '/workplace/freelance',
  validate(freelanceSchema),
  asyncHandler(controller.setFreelance),
);
router.post('/salons', validate(joinSalonSchema), asyncHandler(controller.joinSalon));
// Finalize the workplace step (advances onboarding once the stylist is done).
router.post('/workplace/complete', asyncHandler(controller.completeWorkplace));

// ── Collaboration requests an owner sent to this stylist (owner-initiated) ──
router.get('/salon-requests', validate(salonRequestsQuerySchema), asyncHandler(controller.listSalonRequests));
router.post(
  '/salon-requests/:id/accept',
  validate(salonRequestIdParamsSchema),
  asyncHandler(controller.acceptSalonRequest),
);
router.post(
  '/salon-requests/:id/reject',
  validate(salonRequestIdParamsSchema),
  asyncHandler(controller.rejectSalonRequest),
);
// All salons the stylist is linked to (active + pending) — supports multi-salon.
router.get('/salons', asyncHandler(controller.listSalons));
// Leave a salon (?force=true cancels future confirmed reservations there).
router.delete('/salons/:salonId', validate(leaveSalonSchema), asyncHandler(controller.leaveSalon));

// ── Invite tracking — the stylist follows up on salon invites they created ──
router.get('/invites', asyncHandler(controller.listInvites));
router.post(
  '/invites/:id/resend',
  validate(inviteIdParamsSchema),
  asyncHandler(controller.resendInvite),
);
router.post(
  '/invites/:id/cancel',
  validate(inviteIdParamsSchema),
  asyncHandler(controller.cancelInvite),
);

// Pause / resume accepting new reservations (does not affect existing ones).
router.patch(
  '/availability-status',
  validate(availabilityStatusSchema),
  asyncHandler(controller.setAvailabilityStatus),
);

// Step 4 — working hours.
router.post(
  '/working-hours',
  validate(workingHoursSchema),
  asyncHandler(controller.setWorkingHours),
);
router.get('/working-hours', asyncHandler(controller.getWorkingHours));
router.patch(
  '/working-hours/:id',
  validate(updateWorkingHourSchema),
  asyncHandler(controller.updateWorkingHour),
);
router.delete(
  '/working-hours/:id',
  validate(workingHourIdParamsSchema),
  asyncHandler(controller.deleteWorkingHour),
);

// ── Cancellation policy (plan-gated; per-service is gold-only) ──
router.get('/cancellation-policy', asyncHandler(controller.getCancellationPolicy));
router.put(
  '/cancellation-policy',
  validate(cancellationPolicySchema),
  asyncHandler(controller.setCancellationPolicy),
);
router.delete('/cancellation-policy', asyncHandler(controller.clearCancellationPolicy));
router.put(
  '/cancellation-policy/services/:serviceId',
  validate(servicePolicySchema),
  asyncHandler(controller.setServiceCancellationPolicy),
);
router.delete(
  '/cancellation-policy/services/:serviceId',
  validate(servicePolicyIdParamsSchema),
  asyncHandler(controller.removeServiceCancellationPolicy),
);

// ── Bank payout details (SHEBA + card) — sensitive; owner-only ──
router.get('/payout-info', asyncHandler(controller.getPayoutInfo));
router.put('/payout-info', validate(payoutSchema), asyncHandler(controller.setPayoutInfo));

// Phase 2 — the stylist's own reservations (as the service provider).
router.get(
  '/reservations',
  validate(listReservationsSchema),
  asyncHandler(reservationController.stylistList),
);
// Stylist cancels one of their own (future, confirmed) reservations.
router.patch(
  '/reservations/:id/cancel',
  validate(stylistCancelSchema),
  asyncHandler(reservationController.stylistCancel),
);
// Stylist reschedules one of their own reservations (same shared service).
router.patch(
  '/reservations/:id/reschedule',
  validate(rescheduleSchema),
  asyncHandler(reservationController.reschedule),
);
// Tips received by this stylist (total + list).
router.get('/tips', asyncHandler(reservationController.stylistTips));

// Submit the profile for admin verification (blue tick).
router.post('/profile/submit-verification', asyncHandler(controller.submitVerification));

// National-ID documents (PRIVATE uploader — stored outside the public mount).
const verificationUploader = createUploader('verification', { private: true });
router.post(
  '/verification/documents',
  verificationUploader.fields([
    { name: 'nationalCardFront', maxCount: 1 },
    { name: 'nationalCardBack', maxCount: 1 },
  ]),
  asyncHandler(controller.uploadVerificationDocuments),
);
// Stream the stylist's OWN ID image (owner-only; never a public URL).
router.get(
  '/verification/documents/:side',
  validate(verificationSideSchema),
  asyncHandler(controller.streamOwnVerificationDocument),
);

// Stylist earnings/activity report + analytics (services ranking + weekday).
router.get('/reports', validate(reportRangeSchema), asyncHandler(reportsController.stylistReport));
router.get(
  '/reports/analytics',
  validate(reportRangeSchema),
  asyncHandler(reportsController.stylistAnalytics),
);

// Discount codes (CRUD over the stylist's own codes).
router.post(
  '/discount-codes',
  validate(createDiscountCodeSchema),
  asyncHandler(discountController.create),
);
router.get('/discount-codes', asyncHandler(discountController.list));
router.patch(
  '/discount-codes/:id',
  validate(updateDiscountCodeSchema),
  asyncHandler(discountController.update),
);
router.delete(
  '/discount-codes/:id',
  validate(discountCodeIdParamsSchema),
  asyncHandler(discountController.remove),
);

// ── SMS discount campaign (paid «نقره‌ای» plan; gated by smsCampaignEnabled) ──
// The stylist's own past customers (recipient picker).
router.get('/customers', validate(customersQuerySchema), asyncHandler(campaignController.customers));
// Plan/limit status (drives the lock state in the panel).
router.get('/sms-campaign/status', asyncHandler(campaignController.status));
// Send one OWN discount code to chosen recipients (own customers or a number).
router.post('/sms-campaign/send', validate(sendCampaignSchema), asyncHandler(campaignController.send));

export default router;
