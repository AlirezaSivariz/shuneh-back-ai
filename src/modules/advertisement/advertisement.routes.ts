import { Router } from 'express';
import * as controller from './advertisement.controller';
import { validate } from '../../middlewares/validate';
import { optionalAuthenticate } from '../../middlewares/auth';
import { rateLimit } from '../../middlewares/rateLimit';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  nextAdvertisementSchema,
  impressionAdvertisementSchema,
  clickAdvertisementSchema,
} from './advertisement.validators';

/**
 * Public advertisement endpoints. Auth is optional: when present it enables
 * audience targeting; when absent the visitor is tracked by a guest viewer key
 * supplied by the storefront (with an IP fallback).
 */
const router = Router();

router.use(
  optionalAuthenticate,
  rateLimit({ windowMs: 60_000, max: 240, key: 'ads' }),
);

router.get('/next', validate(nextAdvertisementSchema), asyncHandler(controller.next));
router.post(
  '/:id/impression',
  validate(impressionAdvertisementSchema),
  asyncHandler(controller.impression),
);
router.post('/:id/click', validate(clickAdvertisementSchema), asyncHandler(controller.click));

export default router;
