import { Router } from 'express';
import * as controller from './media.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { createUploader } from '../../middlewares/upload';

const router = Router();
const uploader = createUploader('stylist');

// POST /stylist/media — multipart: one profilePhoto + several portfolio images.
router.post(
  '/',
  authenticate,
  authorize('stylist'),
  uploader.fields([
    { name: 'profilePhoto', maxCount: 1 },
    { name: 'portfolio', maxCount: 10 },
  ]),
  asyncHandler(controller.uploadStylistMedia),
);

// DELETE /stylist/media/portfolio — remove a single portfolio image by its key.
router.delete(
  '/portfolio',
  authenticate,
  authorize('stylist'),
  asyncHandler(controller.deletePortfolioItem),
);

export default router;
