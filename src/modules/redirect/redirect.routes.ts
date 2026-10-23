import { Router } from 'express';
import * as controller from './redirect.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { requireAdmin } from '../../middlewares/requireAdmin';
import { rateLimit } from '../../middlewares/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createRedirectSchema,
  updateRedirectSchema,
  redirectIdSchema,
  listRedirectsSchema,
} from './redirect.validators';

/** Public, read-only: the redirect map the storefront applies at the edge. */
export const redirectPublicRouter = Router();
redirectPublicRouter.get('/map', asyncHandler(controller.map));

/** Admin management of redirects (audited via the generic admin audit trail). */
export const adminRedirectRouter = Router();
adminRedirectRouter.use(authenticate, requireAdmin, rateLimit({ windowMs: 60_000, max: 120, key: 'admin' }));

adminRedirectRouter.get('/', validate(listRedirectsSchema), asyncHandler(controller.list));
adminRedirectRouter.post('/', validate(createRedirectSchema), asyncHandler(controller.create));
adminRedirectRouter.patch('/:id', validate(updateRedirectSchema), asyncHandler(controller.update));
adminRedirectRouter.delete('/:id', validate(redirectIdSchema), asyncHandler(controller.remove));
