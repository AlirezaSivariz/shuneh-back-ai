import { Router } from 'express';
import * as controller from './image.controller';
import { asyncHandler } from '../../utils/asyncHandler';

// Public, stable image URLs: /images/:id (full) and /images/:id/thumb (thumbnail).
// Private images (national_card) are NOT served here — only via the auth-gated
// streaming endpoints. Decoupled from the underlying store (disk or Mongo).
const router = Router();

router.get('/:id/thumb', asyncHandler(controller.getThumbnail));
router.get('/:id', asyncHandler(controller.getImage));

export default router;
