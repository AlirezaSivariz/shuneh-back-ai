import { z } from 'zod';
import { isValidHHmm } from '../../utils/time';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const hhmm = z.string().refine(isValidHHmm, 'Time must be in HH:mm format');

export const setServicesSchema = {
  body: z.object({
    // May be empty: a stylist who offers ONLY custom services sends no default
    // items. The "at least one service total (default or custom)" rule is
    // enforced in the service layer against the persisted set.
    items: z.array(
      z.object({
        serviceId: objectId,
        price: z.number().min(0).nullable().optional(),
        durationMin: z.number().int().min(1).nullable().optional(),
      }),
    ),
  }),
};

// Full replace of the stylist's service set (post-onboarding management).
export const replaceServicesSchema = {
  body: z.object({
    items: z
      .array(
        z.object({
          serviceId: objectId,
          price: z.number().min(0).nullable().optional(),
          durationMin: z.number().int().min(1).nullable().optional(),
        }),
      )
      .min(0),
  }),
};

// Body for add (POST) / edit (PATCH) of a single stylist service.
export const stylistServiceBodySchema = {
  params: z.object({ serviceId: objectId }),
  body: z.object({
    price: z.number().min(0).nullable().optional(),
    durationMin: z.number().int().min(1).nullable().optional(),
  }),
};

export const stylistServiceIdParamsSchema = {
  params: z.object({ serviceId: objectId }),
};

// Custom (stylist-private) services.
export const createCustomServiceSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'نام خدمت لازم است').max(120),
    durationMin: z.number().int().min(1),
    price: z.number().min(0),
    categoryId: objectId.optional(),
  }),
};

export const updateCustomServiceSchema = {
  params: z.object({ serviceId: objectId }),
  body: z
    .object({
      name: z.string().trim().min(1).max(120).optional(),
      durationMin: z.number().int().min(1).optional(),
      price: z.number().min(0).optional(),
      categoryId: objectId.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'حداقل یک فیلد برای ویرایش لازم است'),
};

export const workplaceTypeSchema = {
  body: z.object({
    type: z.enum(['freelance', 'salon']),
  }),
};

export const freelanceSchema = {
  body: z.object({
    address: z.string().trim().min(1, 'address is required'),
    lng: z.number().min(-180).max(180),
    lat: z.number().min(-90).max(90),
  }),
};

export const joinSalonSchema = {
  body: z.object({
    salonId: objectId,
  }),
};

export const leaveSalonSchema = {
  params: z.object({ salonId: objectId }),
  query: z.object({
    // `?force=true` cancels future confirmed reservations and leaves anyway.
    force: z.enum(['true', 'false']).optional(),
  }),
};

export const availabilityStatusSchema = {
  body: z.object({
    isAcceptingReservations: z.boolean(),
  }),
};

export const workingHoursSchema = {
  body: z.object({
    entries: z
      .array(
        z.object({
          salonId: objectId.nullable(),
          dayOfWeek: z.number().int().min(0).max(6),
          start: hhmm,
          end: hhmm,
        }),
      )
      .min(1, 'Provide at least one working-hours entry'),
  }),
};

export const updateWorkingHourSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({
      salonId: objectId.nullable().optional(),
      dayOfWeek: z.number().int().min(0).max(6).optional(),
      start: hhmm.optional(),
      end: hhmm.optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'Provide at least one field to update'),
};

export const workingHourIdParamsSchema = {
  params: z.object({ id: objectId }),
};
