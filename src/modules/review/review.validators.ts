import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const createReviewSchema = {
  params: z.object({ id: objectId }),
  body: z.object({
    rating: z.number().int().min(1).max(5),
    comment: z.string().trim().max(1000).optional(),
  }),
};

export const reservationIdParamsSchema = {
  params: z.object({ id: objectId }),
};

export const stylistReviewsSchema = {
  params: z.object({ id: objectId }),
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
};
