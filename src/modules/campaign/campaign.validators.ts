import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
// Lenient phone shape — the service normalizes (Persian digits, +98, …) and
// strictly re-validates the Iranian mobile form before sending.
const phone = z.string().trim().min(8).max(20);

export const customersQuerySchema = {
  query: z.object({
    search: z.string().trim().max(60).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
};

export const sendCampaignSchema = {
  body: z
    .object({
      discountCodeId: objectId,
      customerIds: z.array(objectId).max(200).optional(),
      recipients: z
        .array(z.object({ phone, name: z.string().trim().max(60).optional() }))
        .max(200)
        .optional(),
    })
    .refine((b) => (b.customerIds?.length ?? 0) + (b.recipients?.length ?? 0) > 0, {
      message: 'حداقل یک گیرنده لازم است',
      path: ['recipients'],
    }),
};
