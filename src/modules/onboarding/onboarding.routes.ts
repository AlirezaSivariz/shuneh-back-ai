import { Router } from 'express';
import * as controller from './onboarding.controller';
import * as reportsController from '../reports/reports.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { setRolesSchema, personalSchema } from './onboarding.validators';
import { reportRangeSchema } from '../reports/reports.validators';

// Routes under /onboarding
export const onboardingRouter = Router();
onboardingRouter.use(authenticate);
onboardingRouter.post('/role', validate(setRolesSchema), asyncHandler(controller.setRoles));
onboardingRouter.get('/state', asyncHandler(controller.getState));

// Routes under /me
export const meRouter = Router();
meRouter.use(authenticate);
meRouter.patch('/personal', validate(personalSchema), asyncHandler(controller.updatePersonal));
// Customer activity/spending report (scoped to the authenticated user).
meRouter.get('/reports', validate(reportRangeSchema), asyncHandler(reportsController.customerReport));
