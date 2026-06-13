import { Router } from 'express';
import * as controller from './stylist.controller';
import * as reservationController from '../reservation/reservation.customer.controller';
import { validate } from '../../middlewares/validate';
import { authenticate, authorize } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  listReservationsSchema,
  stylistCancelSchema,
} from '../reservation/reservation.validators';
import * as reportsController from '../reports/reports.controller';
import { reportRangeSchema } from '../reports/reports.validators';
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
  workingHoursSchema,
  updateWorkingHourSchema,
  workingHourIdParamsSchema,
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
// All salons the stylist is linked to (active + pending) — supports multi-salon.
router.get('/salons', asyncHandler(controller.listSalons));

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

// Stylist earnings/activity report.
router.get('/reports', validate(reportRangeSchema), asyncHandler(reportsController.stylistReport));

export default router;
