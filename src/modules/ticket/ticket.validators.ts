import { z } from 'zod';

const ticketStatusEnum = z.enum(['open', 'in_progress', 'answered', 'closed'], {
  errorMap: () => ({ message: 'وضعیت نامعتبر است' }),
});
const ticketPriorityEnum = z.enum(['low', 'medium', 'high'], {
  errorMap: () => ({ message: 'اولویت نامعتبر است' }),
});

export const createTicketSchema = {
  body: z.object({
    subject: z.string().min(1, 'موضوع الزامی است').max(200),
    priority: ticketPriorityEnum,
    message: z.string().min(1, 'پیام الزامی است').max(5000),
  }),
};

export const ticketIdParamsSchema = {
  params: z.object({ id: z.string().min(1) }),
};

export const addMessageSchema = {
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    text: z.string().min(1, 'متن پیام الزامی است').max(5000),
    attachments: z
      .array(
        z.object({
          url: z.string().max(500),
          name: z.string().max(200),
        }),
      )
      .max(5)
      .optional(),
  }),
};

export const listTicketsSchema = {
  query: z.object({
    status: ticketStatusEnum.optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
};

export const adminListTicketsSchema = {
  query: z.object({
    status: ticketStatusEnum.optional(),
    role: z.enum(['customer', 'stylist', 'owner']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
};

export const updateTicketStatusSchema = {
  params: z.object({ id: z.string().min(1) }),
  body: z.object({
    status: ticketStatusEnum,
  }),
};
