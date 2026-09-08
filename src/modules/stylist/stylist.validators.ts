import { z } from 'zod';
import { isValidHHmm } from '../../utils/time';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const hhmm = z.string().refine(isValidHHmm, 'Time must be in HH:mm format');

// ── Cancellation policy ──
const cancellationPolicyBody = z.object({
  rules: z
    .array(
      z.object({
        hoursBeforeStart: z.number().int().min(0).max(720),
        refundPercent: z.number().int().min(0).max(100),
      }),
    )
    .min(1, 'حداقل یک بازه لازم است')
    .max(6),
  freeRescheduleCount: z.number().int().min(0).max(10).default(2),
  reschedulePenaltyPercent: z.number().int().min(0).max(100).default(5),
});

export const cancellationPolicySchema = { body: cancellationPolicyBody };

export const servicePolicySchema = {
  params: z.object({ serviceId: objectId }),
  body: cancellationPolicyBody,
};

export const servicePolicyIdParamsSchema = {
  params: z.object({ serviceId: objectId }),
};

// ── Payout details (SHEBA + card) — both optional, validated in the service. ──
export const usernameSchema = {
  body: z.object({
    username: z.string().trim().min(1, 'نام کاربری لازم است'),
  }),
};

/** One-line public tagline (شعار متخصص). Empty string clears it. */
export const sloganSchema = {
  body: z.object({
    slogan: z.string().trim().max(30, 'شعار نباید بیشتر از ۳۰ کاراکتر باشد'),
  }),
};
export const payoutSchema = {
  body: z
    .object({
      shebaNumber: z
        .string()
        .trim()
        .regex(/^IR\d{24}$/i, 'شماره شبا باید IR و ۲۴ رقم باشد')
        .nullable()
        .optional(),
      cardNumber: z
        .string()
        .trim()
        .regex(/^\d{16}$/, 'شماره کارت باید ۱۶ رقم باشد')
        .nullable()
        .optional(),
    })
    .refine((b) => b.shebaNumber !== undefined || b.cardNumber !== undefined, {
      message: 'حداقل یکی از شبا یا کارت را وارد کنید',
    }),
};

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
        description: z.string().trim().max(1000).nullable().optional(),
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
          description: z.string().trim().max(1000).nullable().optional(),
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
    showPortfolioOnCard: z.boolean().optional(),
    description: z.string().trim().max(1000).nullable().optional(),
  }),
};

export const stylistServiceIdParamsSchema = {
  params: z.object({ serviceId: objectId }),
};

// Full replace of a service's portfolio image list (delete + reorder).
export const servicePortfolioImagesSchema = {
  params: z.object({ serviceId: objectId }),
  body: z.object({
    images: z.array(z.string().min(1)).max(3),
  }),
};

// Multipart replace of a single portfolio image (index arrives as a string).
export const servicePortfolioReplaceSchema = {
  params: z.object({ serviceId: objectId }),
  body: z.object({
    index: z.coerce.number().int().min(0).max(2),
  }),
};

// Custom (stylist-private) services.
export const createCustomServiceSchema = {
  body: z.object({
    name: z.string().trim().min(1, 'نام خدمت لازم است').max(120),
    durationMin: z.number().int().min(1),
    price: z.number().min(0),
    categoryId: objectId.optional(),
    description: z.string().trim().max(1000).optional(),
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
      description: z.string().trim().max(1000).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'حداقل یک فیلد برای ویرایش لازم است'),
};

export const workplaceTypeSchema = {
  body: z.object({
    type: z.enum(['freelance', 'salon']),
  }),
};

export const freelanceSchema = {
  body: z
    .object({
      serviceLocationType: z.enum(['own_location', 'customer_location']).optional(),
      address: z.string().trim().min(1, 'آدرس محل کار لازم است').optional(),
      lng: z.number().min(-180).max(180).optional(),
      lat: z.number().min(-90).max(90).optional(),
      serviceArea: z.string().trim().max(300).optional(),
      unrestricted: z.boolean().optional(),
    })
    .superRefine((body, ctx) => {
      const type = body.serviceLocationType ?? 'own_location';
      if (type === 'own_location') {
        // Legacy/default flow: a workplace address + map point are required.
        if (!body.address) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['address'],
            message: 'آدرس محل کار لازم است',
          });
        }
        if (body.lng === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['lng'],
            message: 'طول جغرافیایی لازم است',
          });
        }
        if (body.lat === undefined) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['lat'],
            message: 'عرض جغرافیایی لازم است',
          });
        }
      } else if (!(body.serviceArea ?? '').trim() && body.unrestricted !== true) {
        ctx.addIssue({
          code: z.ZodIssueCode.custom,
          path: ['serviceArea'],
          message: 'منطقه خدمت‌رسانی را وارد کنید یا «بدون محدودیت» را انتخاب کنید',
        });
      }
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

export const verificationSideSchema = {
  params: z.object({ side: z.enum(['front', 'back']) }),
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

export const inviteIdParamsSchema = {
  params: z.object({ id: objectId }),
};

export const salonRequestIdParamsSchema = {
  params: z.object({ id: objectId }),
};

export const salonRequestsQuerySchema = {
  query: z.object({ status: z.enum(['pending', 'active', 'rejected']).optional() }),
};
