import { Router } from 'express';
import * as controller from './social.controller';
import { validate } from '../../middlewares/validate';
import { authenticate, optionalAuthenticate } from '../../middlewares/auth';
import { asyncHandler } from '../../utils/asyncHandler';
import { createUploader } from '../../middlewares/upload';
import {
  createPostSchema,
  feedSchema,
  postIdSchema,
  hashtagSchema,
  commentIdSchema,
  addCommentSchema,
  reportSchema,
} from './social.validators';

// Internal social network. Mounted at /social. Feed is public; writes need auth.
const router = Router();
const uploadPostImages = createUploader('social');

// Whether the signed-in user can post (gold-plan stylist, not banned).
router.get('/access', optionalAuthenticate, asyncHandler(controller.access));

// Feed + reads (optionalAuthenticate → personalizes `likedByMe`).
router.get('/feed', optionalAuthenticate, validate(feedSchema), asyncHandler(controller.feed));
router.get('/hashtags/:tag', optionalAuthenticate, validate(hashtagSchema), asyncHandler(controller.hashtag));

// Create a post (gold gating enforced in the service) — up to 8 images.
router.post(
  '/posts',
  authenticate,
  uploadPostImages.array('images', 8),
  validate(createPostSchema),
  asyncHandler(controller.createPost),
);

router.get('/posts/:id', optionalAuthenticate, validate(postIdSchema), asyncHandler(controller.getPost));
router.delete('/posts/:id', authenticate, validate(postIdSchema), asyncHandler(controller.deletePost));
router.post('/posts/:id/like', authenticate, validate(postIdSchema), asyncHandler(controller.like));
router.get('/posts/:id/comments', optionalAuthenticate, validate(postIdSchema), asyncHandler(controller.comments));
router.post('/posts/:id/comments', authenticate, validate(addCommentSchema), asyncHandler(controller.addComment));

router.delete('/comments/:id', authenticate, validate(commentIdSchema), asyncHandler(controller.deleteComment));

router.post('/reports', authenticate, validate(reportSchema), asyncHandler(controller.report));

export default router;
