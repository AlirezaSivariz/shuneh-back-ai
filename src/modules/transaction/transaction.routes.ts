import { Router } from 'express';
import * as controller from './transaction.controller';
import { authenticate, authorize } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';

/** GET /me/transactions — customer's own payment transactions */
export function createCustomerTransactionRoutes(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/', asyncHandler(controller.listMy));
  router.get('/:id', asyncHandler(controller.getMy));
  return router;
}

/** GET /stylist/transactions — transactions related to stylist's reservations */
export function createStylistTransactionRoutes(): Router {
  const router = Router();
  router.use(authenticate, authorize('stylist'));
  router.get('/', asyncHandler(controller.listStylist));
  router.get('/stats', asyncHandler(controller.stats));
  router.get('/:id', asyncHandler(controller.getStylist));
  return router;
}
