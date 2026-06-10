import { Router } from 'express';
import * as controller from './service.controller';
import { asyncHandler } from '../../utils/asyncHandler';

const router = Router();

// Public catalogue of categories + services for the onboarding UI.
router.get('/', asyncHandler(controller.listServices));

export default router;
