import { Router } from 'express';
import * as controller from './plan.controller';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

/** Public — return all plan definitions with pricing, limits, and features. */
router.get('/', asyncHandler(controller.getPlans));

export default router;
