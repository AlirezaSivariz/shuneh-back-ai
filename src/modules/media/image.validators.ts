import { z } from 'zod';

export const imageIdParamsSchema = {
  params: z.object({ id: z.string().min(1) }),
};
