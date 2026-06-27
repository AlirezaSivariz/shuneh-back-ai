import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'شناسه‌ی نامعتبر');

export const listBlogSchema = {
  query: z.object({ page: z.coerce.number().int().min(1).optional() }),
};

export const blogSlugSchema = {
  params: z.object({ slug: z.string().trim().min(1, 'نشانی نوشته لازم است') }),
};

export const blogIdSchema = {
  params: z.object({ id: objectId }),
};

const baseBody = {
  title: z.string().trim().min(2, 'عنوان باید حداقل ۲ کاراکتر باشد').max(200),
  slug: z.string().trim().max(200).optional(),
  excerpt: z.string().trim().max(500).optional(),
  content: z.string().max(100_000).optional(),
  coverImage: z.string().nullable().optional(),
  metaTitle: z.string().trim().max(200).optional(),
  metaDescription: z.string().trim().max(300).optional(),
  status: z.enum(['draft', 'published']).optional(),
};

export const createBlogSchema = {
  body: z.object(baseBody),
};

export const updateBlogSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({ ...baseBody, title: baseBody.title.optional() })
    .refine((b) => Object.keys(b).length > 0, 'حداقل یک فیلد برای ویرایش لازم است'),
};
