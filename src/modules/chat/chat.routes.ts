import { Router } from 'express';
import * as controller from './chat.controller';
import { validate } from '../../middlewares/validate';
import { authenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createConversationSchema,
  conversationIdParamsSchema,
  listMessagesSchema,
  sendMessageSchema,
} from './chat.validators';

const router = Router();

router.use(authenticate);
router.get('/conversations', asyncHandler(controller.list));
router.post('/conversations', validate(createConversationSchema), asyncHandler(controller.create));
router.get('/unread', asyncHandler(controller.unread));
router.get(
  '/conversations/:id/messages',
  validate(listMessagesSchema),
  asyncHandler(controller.messages),
);
router.post(
  '/conversations/:id/messages',
  validate(sendMessageSchema),
  asyncHandler(controller.send),
);
router.post(
  '/conversations/:id/read',
  validate(conversationIdParamsSchema),
  asyncHandler(controller.read),
);

export default router;
