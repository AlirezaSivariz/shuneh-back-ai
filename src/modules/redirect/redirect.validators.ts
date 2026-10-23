import { z } from 'zod';

/** A site-relative path: starts with `/`, no scheme, no spaces. */
const pathSchema = z
  .string()
  .trim()
  .min(2, 'آدرس الزامی است')
  .refine((v) => v.startsWith('/'), 'آدرس باید با / شروع شود')
  .refine((v) => !v.includes('://') && !/\s/.test(v), 'آدرس باید یک مسیر داخلی باشد (بدون دامنه و فاصله)')
  .refine((v) => !v.startsWith('//'), 'آدرس نمی‌تواند با // شروع شود');

const statusSchema = z
  .union([z.literal(301), z.literal(302), z.literal('301'), z.literal('302')])
  .transform((v) => (v === 302 || v === '302' ? 302 : 301) as 301 | 302)
  .optional();

export const createRedirectSchema = {
  body: z.object({
    fromPath: pathSchema,
    toPath: pathSchema,
    statusCode: statusSchema,
    note: z.string().trim().max(200).optional(),
  }),
};

export const updateRedirectSchema = {
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    toPath: pathSchema.optional(),
    statusCode: statusSchema,
    note: z.string().trim().max(200).optional(),
  }),
};

export const redirectIdSchema = {
  params: z.object({ id: z.string().min(1) }),
};

export const listRedirectsSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().optional(),
  }),
};
