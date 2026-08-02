import { Router } from 'express';
import * as controller from './community.controller';
import { validate } from '../../middlewares/validate';
import { authenticate, optionalAuthenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import {
  createQuestionSchema,
  listQuestionsSchema,
  questionIdSchema,
  answerIdSchema,
  createAnswerSchema,
} from './community.validators';

/**
 * Community Q&A forum. Mounted at /community. Reads are public (personalized
 * for signed-in viewers); writes require authentication.
 */
const router = Router();

router.get(
  '/questions',
  optionalAuthenticate,
  validate(listQuestionsSchema),
  asyncHandler(controller.listQuestions),
);
router.get(
  '/questions/:id',
  optionalAuthenticate,
  validate(questionIdSchema),
  asyncHandler(controller.getQuestion),
);
router.post(
  '/questions',
  authenticate,
  validate(createQuestionSchema),
  asyncHandler(controller.createQuestion),
);
router.post(
  '/questions/:id/answers',
  authenticate,
  validate(createAnswerSchema),
  asyncHandler(controller.addAnswer),
);
router.post(
  '/questions/:id/like',
  authenticate,
  validate(questionIdSchema),
  asyncHandler(controller.likeQuestion),
);
router.post(
  '/questions/:id/save',
  authenticate,
  validate(questionIdSchema),
  asyncHandler(controller.saveQuestion),
);
router.post(
  '/answers/:id/like',
  authenticate,
  validate(answerIdSchema),
  asyncHandler(controller.likeAnswer),
);

export default router;
