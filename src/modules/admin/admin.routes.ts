import { Router } from 'express';
import * as controller from './admin.controller';
import { validate } from '../../middlewares/validate';
import { requireInternalKey } from '../../middlewares/internalKey';
import { asyncHandler } from '../../utils/asyncHandler';
import { promoteSchema, stylistIdParamsSchema } from './admin.validators';

/**
 * Admin routes — guarded by the internal API key (set INTERNAL_API_KEY in
 * production; open in development). Manual stylist promotion until billing.
 */
export const adminRouter = Router();
adminRouter.use(requireInternalKey);

adminRouter.post(
  '/stylists/:id/promote',
  validate(promoteSchema),
  asyncHandler(controller.promote),
);
adminRouter.post(
  '/stylists/:id/unpromote',
  validate(stylistIdParamsSchema),
  asyncHandler(controller.unpromote),
);
