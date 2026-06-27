import { Router } from 'express';
import * as controller from './blog.controller';
import { validate } from '../../middlewares/validate';
import { asyncHandler } from '../../utils/asyncHandler';
import { listBlogSchema, blogSlugSchema } from './blog.validators';

// Public, SEO-facing blog endpoints (published posts only).
const router = Router();

router.get('/', validate(listBlogSchema), asyncHandler(controller.list));
router.get('/:slug', validate(blogSlugSchema), asyncHandler(controller.getBySlug));

export default router;
