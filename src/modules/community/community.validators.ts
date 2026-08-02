import { z } from 'zod';
import { COMMUNITY_QUESTION_CATEGORIES } from '../../models/CommunityQuestion';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'شناسه‌ی نامعتبر');

const category = z.enum(COMMUNITY_QUESTION_CATEGORIES as [string, ...string[]]);

export const createQuestionSchema = {
  body: z.object({
    title: z.string().trim().min(1, 'عنوان سوال لازم است').max(200),
    content: z.string().trim().min(1, 'توضیحات سوال لازم است').max(2000),
    category,
  }),
};

export const listQuestionsSchema = {
  query: z.object({
    category: category.optional(),
    sort: z.enum(['latest', 'popular', 'unanswered']).optional(),
    search: z.string().trim().max(200).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
};

export const questionIdSchema = {
  params: z.object({ id: objectId }),
};

export const answerIdSchema = {
  params: z.object({ id: objectId }),
};

export const createAnswerSchema = {
  params: z.object({ id: objectId }),
  body: z.object({
    content: z.string().trim().min(1, 'متن پاسخ لازم است').max(2000),
  }),
};
