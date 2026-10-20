import { z } from 'zod';

export const createConversationSchema = {
  body: z.object({
    stylistId: z.string().min(1, 'شناسه متخصص الزامی است'),
  }),
};

export const conversationIdParamsSchema = {
  params: z.object({ id: z.string().min(1) }),
};

export const listMessagesSchema = {
  params: z.object({ id: z.string().min(1) }),
  query: z.object({
    after: z.string().optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
};

export const sendMessageSchema = {
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    text: z.string().trim().min(1, 'متن پیام الزامی است').max(2000, 'متن پیام بیش از حد طولانی است'),
  }),
};
