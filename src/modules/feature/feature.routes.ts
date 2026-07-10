import { Router } from 'express';
import * as controller from './feature.controller';
import { authenticate } from '../../middlewares/auth';
import { requireAdmin } from '../../middlewares/requireAdmin';
import { asyncHandler } from '../../utils/asyncHandler';

export const adminFeatureRouter = Router();
adminFeatureRouter.use(authenticate, requireAdmin);

adminFeatureRouter.get('/overrides', asyncHandler(controller.listOverrides));
adminFeatureRouter.post('/overrides', asyncHandler(controller.createOverride));
adminFeatureRouter.delete('/overrides/:userId/:featureKey', asyncHandler(controller.removeOverride));
adminFeatureRouter.get('/overrides/:userId', asyncHandler(controller.getOverridesForUser));

export const userFeatureRouter = Router();
userFeatureRouter.use(authenticate);
userFeatureRouter.get('/features', asyncHandler(controller.getMyFeatures));
