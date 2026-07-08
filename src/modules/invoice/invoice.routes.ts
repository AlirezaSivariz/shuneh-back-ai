import { Router } from 'express';
import * as controller from './invoice.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { z } from 'zod';

const idParamsSchema = {
  params: z.object({
    id: z.string().min(1),
  }),
};

export function createInvoiceRoutes(): Router {
  const router = Router();
  router.use(authenticate);

  router.get('/:id', validate(idParamsSchema), asyncHandler(controller.getInvoice));

  return router;
}
