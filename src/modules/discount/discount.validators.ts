import { z } from 'zod';
import { isValidHHmm } from '../../utils/time';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');
const hhmm = z.string().refine(isValidHHmm, 'ساعت باید به فرمت HH:mm باشد');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ باید به فرمت YYYY-MM-DD باشد');

const timeConstraints = z.object({
  daysOfWeek: z.array(z.number().int().min(0).max(6)).nullable().optional(),
  startTime: hhmm.nullable().optional(),
  endTime: hhmm.nullable().optional(),
});

const baseFields = {
  code: z
    .string()
    .trim()
    .min(1, 'کد لازم است')
    .max(32)
    .regex(/^[A-Za-z0-9_-]+$/, 'کد فقط می‌تواند شامل حروف انگلیسی، عدد، خط تیره و زیرخط باشد'),
  type: z.enum(['percentage', 'fixed']),
  value: z.number().positive('مقدار باید بزرگ‌تر از صفر باشد'),
  maxDiscountAmount: z.number().min(0).nullable().optional(),
  appliesTo: z.enum(['all', 'services']).default('all'),
  serviceIds: z.array(objectId).optional(),
  validFrom: dateStr.nullable().optional(),
  validUntil: dateStr.nullable().optional(),
  timeConstraints: timeConstraints.optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  isActive: z.boolean().optional(),
};

type Body = Record<string, unknown>;
const tcOf = (b: Body) => b.timeConstraints as { startTime?: string; endTime?: string } | undefined;

/** Percentage value must be 1..100 when both type and value are present. */
const percentOk = (b: Body) =>
  b.type !== 'percentage' || b.value == null || ((b.value as number) >= 1 && (b.value as number) <= 100);
/** validFrom must not be after validUntil (when both present). */
const dateOrderOk = (b: Body) =>
  !(b.validFrom && b.validUntil) || (b.validFrom as string) <= (b.validUntil as string);
/** time window start before end (when both present). */
const timeOrderOk = (b: Body) => {
  const tc = tcOf(b);
  return !(tc?.startTime && tc?.endTime) || tc.startTime < tc.endTime;
};

export const createDiscountCodeSchema = {
  body: z
    .object(baseFields)
    .refine(percentOk, { message: 'درصد تخفیف باید بین ۱ تا ۱۰۰ باشد', path: ['value'] })
    .refine((b) => b.appliesTo !== 'services' || (b.serviceIds?.length ?? 0) > 0, {
      message: 'برای «خدمات انتخابی» حداقل یک خدمت لازم است',
      path: ['serviceIds'],
    })
    .refine(dateOrderOk, { message: 'تاریخ شروع باید قبل از تاریخ پایان باشد', path: ['validUntil'] })
    .refine(timeOrderOk, {
      message: 'ساعت شروع باید قبل از ساعت پایان باشد',
      path: ['timeConstraints', 'endTime'],
    }),
};

export const updateDiscountCodeSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object({
      ...baseFields,
      code: baseFields.code.optional(),
      type: baseFields.type.optional(),
      value: baseFields.value.optional(),
      appliesTo: z.enum(['all', 'services']).optional(),
    })
    .refine((b) => Object.keys(b).length > 0, 'حداقل یک فیلد برای ویرایش لازم است')
    .refine(percentOk, { message: 'درصد تخفیف باید بین ۱ تا ۱۰۰ باشد', path: ['value'] })
    // Lenient: only when serviceIds is explicitly provided as empty for 'services'.
    .refine((b) => b.appliesTo !== 'services' || b.serviceIds === undefined || b.serviceIds.length > 0, {
      message: 'برای «خدمات انتخابی» حداقل یک خدمت لازم است',
      path: ['serviceIds'],
    })
    .refine(dateOrderOk, { message: 'تاریخ شروع باید قبل از تاریخ پایان باشد', path: ['validUntil'] })
    .refine(timeOrderOk, {
      message: 'ساعت شروع باید قبل از ساعت پایان باشد',
      path: ['timeConstraints', 'endTime'],
    }),
};

export const discountCodeIdParamsSchema = {
  params: z.object({ id: objectId }),
};

/** Customer-facing: preview a code for a prospective booking. */
export const validateDiscountSchema = {
  body: z
    .object({
      stylistId: objectId,
      code: z.string().trim().min(1, 'کد لازم است'),
      serviceId: objectId.optional(),
      serviceIds: z.array(objectId).min(1).optional(),
      date: dateStr,
      startTime: hhmm,
    })
    .transform((b) => ({
      ...b,
      serviceIds: b.serviceIds ?? (b.serviceId ? [b.serviceId] : []),
    }))
    .refine((b) => b.serviceIds.length > 0, {
      message: 'حداقل یک خدمت لازم است',
      path: ['serviceIds'],
    }),
};
