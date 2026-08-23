import { Router } from 'express';
import * as controller from './media.controller';
import { validate } from '../../middlewares/validate';
import { authenticate, authorize } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { createUploader } from '../../middlewares/upload';
import { z } from 'zod';

const router = Router();
const uploader = createUploader('stylist');

const deletePortfolioSchema = {
  body: z.object({
    key: z.string().min(1, 'شناسه‌ی نمونه‌کار لازم است').max(200),
  }),
};

// POST /stylist/media — multipart: one profilePhoto + one cover + several portfolio images.
router.post(
  '/',
  authenticate,
  authorize('stylist'),
  uploader.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'portfolio', maxCount: 10 },
    { name: 'cover', maxCount: 1 },
  ]),
  asyncHandler(controller.uploadStylistMedia),
);

// DELETE /stylist/media/portfolio — remove a single portfolio image by its key.
router.delete(
  '/portfolio',
  authenticate,
  authorize('stylist'),
  validate(deletePortfolioSchema),
  asyncHandler(controller.deletePortfolioItem),
);

// DELETE /stylist/media/cover — remove the public cover image.
router.delete(
  '/cover',
  authenticate,
  authorize('stylist'),
  asyncHandler(controller.deleteCover),
);

export default router;
