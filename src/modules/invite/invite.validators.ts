import { z } from 'zod';
import { isValidHHmm } from '../../utils/time';

const hhmm = z.string().refine(isValidHHmm, 'Time must be in HH:mm format');

export const inviteTokenParamsSchema = {
  params: z.object({
    token: z.string().min(10, 'Invalid token'),
  }),
};

export const acceptInviteSchema = {
  params: z.object({
    token: z.string().min(10, 'Invalid token'),
  }),
  body: z.object({
    name: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(1000).optional(),
    address: z.string().trim().min(1).optional(),
    lng: z.number().min(-180).max(180).optional(),
    lat: z.number().min(-90).max(90).optional(),
    openingHours: z
      .array(
        z.object({
          dayOfWeek: z.number().int().min(0).max(6),
          intervals: z.array(z.object({ start: hhmm, end: hhmm })).default([]),
        }),
      )
      .optional(),
  }),
};
