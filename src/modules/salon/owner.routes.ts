import { Router } from 'express';
import * as controller from './salon.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';

// Routes under /owner — salon management from the owner's perspective.
export const ownerRouter = Router();

ownerRouter.use(authenticate, authorize('owner'));

// List all salons this owner owns.
ownerRouter.get('/salons', asyncHandler(controller.listOwnerSalons));
