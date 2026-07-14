import { Router } from 'express';
import * as controller from './bank.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { updateBankInfoSchema } from './bank.validators';

const router = Router();

router.use(authenticate);

router.get('/bank-info', asyncHandler(controller.getBankInfo));
router.put('/bank-info', validate(updateBankInfoSchema), asyncHandler(controller.setBankInfo));

export default router;
