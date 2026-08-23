import { Router } from 'express';
import * as controller from './feature.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { requireAdmin } from '../../middlewares/requireAdmin';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  listOverridesSchema,
  userIdParamsSchema,
  createOverrideSchema,
  overrideParamsSchema,
} from './feature.validators';

export const adminFeatureRouter = Router();
adminFeatureRouter.use(authenticate, requireAdmin);

adminFeatureRouter.get('/overrides', validate(listOverridesSchema), asyncHandler(controller.listOverrides));
adminFeatureRouter.post('/overrides', validate(createOverrideSchema), asyncHandler(controller.createOverride));
adminFeatureRouter.delete('/overrides/:userId/:featureKey', validate(overrideParamsSchema), asyncHandler(controller.removeOverride));
adminFeatureRouter.get('/overrides/:userId', validate(userIdParamsSchema), asyncHandler(controller.getOverridesForUser));

export const userFeatureRouter = Router();
userFeatureRouter.use(authenticate);
userFeatureRouter.get('/features', asyncHandler(controller.getMyFeatures));
