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
  createStorySchema,
  authorIdSchema,
  storyIdSchema,
} from './social.validators';

// Internal social network. Mounted at /social. Feed is public; writes need auth.
const router = Router();
const uploadPostImages = createUploader('social');

// Whether the signed-in user can post (gold-plan stylist, not banned).
router.get('/access', optionalAuthenticate, asyncHandler(controller.access));

// Feed + reads (optionalAuthenticate → personalizes `likedByMe`).
router.get('/feed', optionalAuthenticate, validate(feedSchema), asyncHandler(controller.feed));
router.get('/hashtags/:tag', optionalAuthenticate, validate(hashtagSchema), asyncHandler(controller.hashtag));

// The viewer's saved/bookmarked posts.
router.get('/saved', authenticate, validate(feedSchema), asyncHandler(controller.savedPosts));

// Create a post (gold gating enforced in the service). `normal` → up to 8
// `images`; `before_after` → one `before` + one `after`.
router.post(
  '/posts',
  authenticate,
  uploadPostImages.fields([
    { name: 'images', maxCount: 8 },
    { name: 'before', maxCount: 1 },
    { name: 'after', maxCount: 1 },
  ]),
  validate(createPostSchema),
  asyncHandler(controller.createPost),
);

router.get('/posts/:id', optionalAuthenticate, validate(postIdSchema), asyncHandler(controller.getPost));
router.delete('/posts/:id', authenticate, validate(postIdSchema), asyncHandler(controller.deletePost));
router.post('/posts/:id/like', authenticate, validate(postIdSchema), asyncHandler(controller.like));
router.post('/posts/:id/save', authenticate, validate(postIdSchema), asyncHandler(controller.toggleSave));
router.get('/posts/:id/comments', optionalAuthenticate, validate(postIdSchema), asyncHandler(controller.comments));
router.post('/posts/:id/comments', authenticate, validate(addCommentSchema), asyncHandler(controller.addComment));

router.delete('/comments/:id', authenticate, validate(commentIdSchema), asyncHandler(controller.deleteComment));

router.post('/reports', authenticate, validate(reportSchema), asyncHandler(controller.report));

// ── Follow / unfollow a stylist ──
router.post('/stylists/:id/follow', authenticate, validate(postIdSchema), asyncHandler(controller.toggleFollow));
router.get(
  '/stylists/:id/followers-count',
  optionalAuthenticate,
  validate(postIdSchema),
  asyncHandler(controller.followersCount),
);

// ── Stories (ephemeral 24h photos) ──
router.get('/stories', optionalAuthenticate, asyncHandler(controller.storiesFeed));
router.post(
  '/stories',
  authenticate,
  uploadPostImages.single('image'),
  validate(createStorySchema),
  asyncHandler(controller.createStory),
);
router.get('/stories/:authorId', optionalAuthenticate, validate(authorIdSchema), asyncHandler(controller.authorStories));
router.delete('/stories/:id', authenticate, validate(storyIdSchema), asyncHandler(controller.deleteStory));
router.post('/stories/:id/seen', authenticate, validate(storyIdSchema), asyncHandler(controller.markStorySeen));
router.get('/stories/:id/viewers', authenticate, validate(storyIdSchema), asyncHandler(controller.storyViewers));

export default router;
