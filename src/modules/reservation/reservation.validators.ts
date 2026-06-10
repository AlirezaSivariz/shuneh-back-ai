import { z } from 'zod';
import { isValidHHmm } from '../../utils/time';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const createReservationSchema = {
  body: z
    .object({
      stylistId: objectId,
      salonId: objectId.nullable().optional(),
      // Accept either a single serviceId or a serviceIds array.
      serviceId: objectId.optional(),
      serviceIds: z.array(objectId).min(1).optional(),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'date must be YYYY-MM-DD'),
      startTime: z.string().refine(isValidHHmm, 'startTime must be HH:mm'),
    })
    .transform((b) => ({
      ...b,
      serviceIds: b.serviceIds ?? (b.serviceId ? [b.serviceId] : []),
    }))
    .refine((b) => b.serviceIds.length > 0, {
      message: 'At least one service is required',
      path: ['serviceIds'],
    }),
};

export const listReservationsSchema = {
  query: z.object({
    filter: z.enum(['upcoming', 'past']).optional(),
  }),
};

export const reservationIdParamsSchema = {
  params: z.object({ id: objectId }),
};

export const stylistCancelSchema = {
  params: z.object({ id: objectId }),
  body: z.object({
    reason: z.string().trim().max(500).optional(),
  }),
};
