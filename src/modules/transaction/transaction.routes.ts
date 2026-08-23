import { Router } from 'express';
import * as controller from './transaction.controller';
import { validate } from '../../middlewares/validate';
import { authenticate, authorize } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { listTransactionsSchema, transactionIdParamsSchema } from './transaction.validators';

/** GET /me/transactions — customer's own payment transactions */
export function createCustomerTransactionRoutes(): Router {
  const router = Router();
  router.use(authenticate);
  router.get('/', validate(listTransactionsSchema), asyncHandler(controller.listMy));
  router.get('/:id', validate(transactionIdParamsSchema), asyncHandler(controller.getMy));
  return router;
}

/** GET /stylist/transactions — transactions related to stylist's reservations */
export function createStylistTransactionRoutes(): Router {
  const router = Router();
  router.use(authenticate, authorize('stylist'));
  router.get('/', validate(listTransactionsSchema), asyncHandler(controller.listStylist));
  router.get('/stats', asyncHandler(controller.stats));
  router.get('/:id', validate(transactionIdParamsSchema), asyncHandler(controller.getStylist));
  return router;
}
