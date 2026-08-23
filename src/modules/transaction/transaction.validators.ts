import { z } from 'zod';

const transactionStatusEnum = z.enum(['pending', 'completed', 'failed', 'refunded'], {
  errorMap: () => ({ message: 'وضعیت نامعتبر است' }),
});

export const listTransactionsSchema = {
  query: z.object({
    status: transactionStatusEnum.optional(),
    purpose: z.string().max(50).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
};

export const transactionIdParamsSchema = {
  params: z.object({ id: z.string().min(1) }),
};
