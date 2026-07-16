import { Router } from 'express';
import * as controller from './credit.controller';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { walletQuerySchema, planPurchaseSchema } from './credit.validators';

export const creditRouter = Router();

creditRouter.get('/', asyncHandler(controller.getWallet));
creditRouter.get('/settings', asyncHandler(controller.getPublicSettings));
creditRouter.get('/history', validate(walletQuerySchema), asyncHandler(controller.listTransactions));
creditRouter.post('/purchase-plan', validate(planPurchaseSchema), asyncHandler(controller.purchasePlan));
