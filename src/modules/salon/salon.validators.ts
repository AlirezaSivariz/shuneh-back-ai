import { z } from 'zod';
import { isValidHHmm } from '../../utils/time';
import { SERVICE_GENDERS } from '../../models/Salon';
import { findProvince, isValidProvinceCity } from '../../data/iranGeo';

const hhmm = z.string().refine(isValidHHmm, 'Time must be in HH:mm format');
const serviceGender = z.enum(SERVICE_GENDERS as [string, ...string[]]);

const province = z.string().trim().min(1);
const city = z.string().trim().min(1);

/**
 * Reusable (province, city) consistency refinements against the shared geo
 * dataset. Both fields are optional, but if either is set the other must be too
 * and the pair must be valid — so a salon never carries a province without a
 * matching city (or a bogus name). Applied to both create and update bodies.
 */
const refineProvinceCity = <T extends z.ZodTypeAny>(schema: T) =>
  schema
    .refine(
      (b: { province?: string; city?: string }) =>
        (b.province === undefined) === (b.city === undefined),
      { message: 'province and city must be provided together', path: ['city'] },
    )
    .refine(
      (b: { province?: string }) => b.province === undefined || findProvince(b.province) !== undefined,
      { message: 'province is not a valid Iran province', path: ['province'] },
    )
    .refine(
      (b: { province?: string; city?: string }) =>
        b.province === undefined || isValidProvinceCity(b.province, b.city),
      { message: 'city does not belong to the selected province', path: ['city'] },
    );

const openingHoursSchema = z.array(
  z.object({
    dayOfWeek: z.number().int().min(0).max(6),
    intervals: z
      .array(z.object({ start: hhmm, end: hhmm }))
      .default([]),
  }),
);

// Salon default cancellation policy (owner-defined; not plan-gated).
export const cancellationPolicyBody = z.object({
  rules: z
    .array(
      z.object({
        hoursBeforeStart: z.number().int().min(0).max(720),
        refundPercent: z.number().int().min(0).max(100),
      }),
    )
    .min(1)
    .max(6),
  freeRescheduleCount: z.number().int().min(0).max(10).default(1),
  reschedulePenaltyPercent: z.number().int().min(0).max(100).default(0),
});

export const searchSalonsSchema = {
  query: z.object({
    name: z.string().trim().optional(),
    province: province.optional(),
    city: city.optional(),
    lng: z.coerce.number().min(-180).max(180).optional(),
    lat: z.coerce.number().min(-90).max(90).optional(),
    radius: z.coerce.number().positive().optional(),
    gender: serviceGender.optional(),
  }),
};

export const createSalonSchema = {
  body: refineProvinceCity(
    z.object({
      name: z.string().trim().min(1).max(120),
      description: z.string().trim().max(1000).optional(),
      address: z.string().trim().min(1),
      province: province.optional(),
      city: city.optional(),
      lng: z.number().min(-180).max(180),
      lat: z.number().min(-90).max(90),
      serviceGender: serviceGender.optional(),
      openingHours: openingHoursSchema.default([]),
      cancellationPolicy: cancellationPolicyBody.optional(),
    }),
  ),
};

export const byOwnerPhoneSchema = {
  query: z.object({
    phone: z
      .string()
      .trim()
      .regex(/^09\d{9}$/, 'phone must be a valid Iranian mobile number'),
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
  body: refineProvinceCity(
    z
      .object({
        name: z.string().trim().min(1).max(120).optional(),
        description: z.string().trim().max(1000).optional(),
        address: z.string().trim().min(1).optional(),
        province: province.optional(),
        city: city.optional(),
        lng: z.number().min(-180).max(180).optional(),
        lat: z.number().min(-90).max(90).optional(),
        serviceGender: serviceGender.optional(),
        openingHours: openingHoursSchema.optional(),
        cancellationPolicy: cancellationPolicyBody.nullable().optional(),
      })
      .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update')
      .refine(
        (b) => (b.lng === undefined) === (b.lat === undefined),
        'lng and lat must be provided together',
      ),
  ),
};

export const salonIdParamsSchema = {
  params: z.object({ salonId: objectId }),
};

// Public salon-detail route uses `:id`.
export const salonDetailParamsSchema = {
  params: z.object({ id: objectId }),
};

export const inviteStylistSchema = {
  params: z.object({ salonId: objectId }),
  body: z.object({ stylistId: objectId }),
};

export const ownerStylistSearchSchema = {
  query: z.object({ q: z.string().trim().min(1).max(60) }),
};
