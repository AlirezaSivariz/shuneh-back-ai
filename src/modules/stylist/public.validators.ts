import { z } from 'zod';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const searchStylistsSchema = {
  query: z.object({
    serviceId: objectId.optional(),
    categoryId: objectId.optional(),
    name: z.string().trim().optional(),
    province: z.string().trim().optional(),
    city: z.string().trim().optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    radius: z.coerce.number().int().min(1).max(100000).optional(),
    gender: z.enum(['women', 'men', 'unisex']).optional(),
  }),
};

export const homeStylistsSchema = {
  query: z.object({
    limit: z.coerce.number().int().min(1).max(24).optional(),
  }),
};

export const stylistIdParamsSchema = {
  params: z.object({ id: objectId }),
};

const serviceIdsCsv = z
  .string()
  .min(1, 'serviceIds is required')
  .transform((s) => s.split(',').map((x) => x.trim()).filter(Boolean));

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD');

export const availabilitySchema = {
  params: z.object({ id: objectId }),
  query: z.object({
    date: dateStr,
    serviceIds: serviceIdsCsv,
    // When set (reschedule flow), this reservation's own slot is treated as free.
    excludeReservationId: objectId.optional(),
  }),
};

export const availableDaysSchema = {
  params: z.object({ id: objectId }),
  query: z.object({
    from: dateStr,
    to: dateStr,
    serviceIds: serviceIdsCsv,
  }),
};
