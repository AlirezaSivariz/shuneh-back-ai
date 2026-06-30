import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'شناسه‌ی نامعتبر');

/** Multipart text fields arrive as strings; coerce `acceptedRules`. */
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => v === true || v === 'true' || v === '1');

export const createPostSchema = {
  body: z.object({
    caption: z.string().max(2200).optional().default(''),
    acceptedRules: boolish,
    type: z.enum(['normal', 'before_after']).optional(),
    // Multipart string; "" → no related service. Validated against the stylist's
    // own services in the service layer.
    relatedServiceId: z.string().optional(),
  }),
};

export const feedSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    // 'following' → only posts from stylists the signed-in user follows.
    mode: z.enum(['all', 'following']).optional(),
  }),
};

export const postIdSchema = {
  params: z.object({ id: objectId }),
};

export const hashtagSchema = {
  params: z.object({ tag: z.string().trim().min(1).max(60) }),
  query: z.object({ page: z.coerce.number().int().min(1).optional() }),
};

export const commentIdSchema = {
  params: z.object({ id: objectId }),
};

export const addCommentSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ text: z.string().trim().min(1, 'متن کامنت لازم است').max(1000) }),
};

export const reportSchema = {
  body: z.object({
    targetType: z.enum(['post', 'comment', 'story']),
    targetId: objectId,
    reason: z.string().trim().min(1, 'دلیل گزارش لازم است').max(500),
  }),
};

// ── Stories ──
export const createStorySchema = {
  body: z.object({
    caption: z.string().max(500).optional().default(''),
    acceptedRules: boolish,
  }),
};

export const authorIdSchema = {
  params: z.object({ authorId: objectId }),
};

export const storyIdSchema = {
  params: z.object({ id: objectId }),
};
