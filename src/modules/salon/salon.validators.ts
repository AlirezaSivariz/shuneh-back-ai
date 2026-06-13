import { z } from 'zod';
import { isValidHHmm } from '../../utils/time';

const hhmm = z.string().refine(isValidHHmm, 'Time must be in HH:mm format');

const openingHoursSchema = z.array(
  z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    intervals: z
      .array(z.object({ start: hhmm, end: hhmm }))
      .default([]),
  }),
);

export const searchSalonsSchema = {
  query: z.object({
    name: z.string().trim().optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    radius: z.coerce.number().positive().optional(),
  }),
};

export const createSalonSchema = {
  body: z.object({
    name: z.string().trim().min(1).max(120),
    description: z.string().trim().max(1000).optional(),
    address: z.string().trim().min(1),
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
    openingHours: openingHoursSchema.default([]),
  }),
};

export const salonInviteSchema = {
  body: z.object({
    targetPhone: z
      .string()
      .trim()
      .regex(/^09\d{9}$/, 'targetPhone must be a valid Iranian mobile number'),
    salonDraft: z.record(z.unknown()),
  }),
};

export const stylistApprovalParamsSchema = {
  params: z.object({
    salonId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid salonId'),
    stylistId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid stylistId'),
  }),
};

export const salonStylistsSchema = {
  params: z.object({
    salonId: z.string().regex(/^[a-f\d]{24}$/i, 'Invalid salonId'),
  }),
  query: z.object({
    status: z.enum(['pending', 'active', 'rejected']).optional(),
  }),
};

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid salonId');

export const updateSalonSchema = {
  params: z.object({ salonId: objectId }),
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      description: z.string().trim().max(1000).optional(),
      address: z.string().trim().min(1).optional(),
      lng: z.number().min(-180).max(180).optional(),
      lat: z.number().min(-90).max(90).optional(),
      openingHours: openingHoursSchema.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update')
    .refine(
      (b) => (b.lng === undefined) === (b.lat === undefined),
      'lng and lat must be provided together',
    ),
};

export const salonIdParamsSchema = {
  params: z.object({ salonId: objectId }),
};
