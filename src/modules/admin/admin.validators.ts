import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const promoteSchema = {
  params: z.object({ id: objectId }),
  body: z.object({
    until: z.coerce.date().refine((d) => d.getTime() > Date.now(), '`until` must be in the future'),
    tier: z.number().int().min(1).optional(),
  }),
};

export const stylistIdParamsSchema = {
  params: z.object({ id: objectId }),
};
