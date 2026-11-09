import { z } from 'zod';
import { isValidHHmm } from '../../utils/time';
import { COUPON_CAMPAIGN_TYPES } from '../../models/Coupon';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'شناسه نامعتبر است');
const hhmm = z.string().refine(isValidHHmm, 'ساعت باید به فرمت HH:mm باشد');
const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ باید به فرمت YYYY-MM-DD باشد');

const baseFields = {
  code: z
    .string()
    .trim()
    .min(3, 'کد باید حداقل ۳ کاراکتر باشد')
    .max(30, 'کد نباید بیشتر از ۳۰ کاراکتر باشد')
    .regex(/^[A-Za-z0-9_-]+$/, 'کد فقط می‌تواند شامل حروف انگلیسی، عدد، خط تیره و زیرخط باشد'),
  name: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  campaign: z.enum(COUPON_CAMPAIGN_TYPES as [string, ...string[]]),
  type: z.enum(['percentage', 'fixed']),
  value: z.number().positive('مقدار باید بزرگ‌تر از صفر باشد'),
  maxDiscountAmount: z.number().min(0).nullable().optional(),
  minBookingAmount: z.number().min(0).optional(),
  validFrom: dateStr.nullable().optional(),
  validUntil: dateStr.nullable().optional(),
  usageLimit: z.number().int().min(1).nullable().optional(),
  perCustomerLimit: z.number().int().min(1).nullable().optional(),
  newCustomersOnly: z.boolean().optional(),
  categoryIds: z.array(objectId).optional(),
  stylistIds: z.array(objectId).optional(),
  isActive: z.boolean().optional(),
};

type Body = Record<string, unknown>;
const percentOk = (b: Body) =>
  b.type !== 'percentage' ||
  b.value == null ||
  ((b.value as number) >= 1 && (b.value as number) <= 100);
const dateOrderOk = (b: Body) =>
  !(b.validFrom && b.validUntil) || (b.validFrom as string) <= (b.validUntil as string);

export const createCouponSchema = {
  body: z
    .object(baseFields)
    .refine(percentOk, { message: 'درصد تخفیف باید بین ۱ تا ۱۰۰ باشد', path: ['value'] })
    .refine(dateOrderOk, { message: 'تاریخ شروع باید قبل از تاریخ پایان باشد', path: ['validUntil'] }),
};

export const updateCouponSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object(baseFields)
    .partial()
    .refine((b) => Object.keys(b).length > 0, 'حداقل یک فیلد برای ویرایش لازم است')
    .refine(percentOk, { message: 'درصد تخفیف باید بین ۱ تا ۱۰۰ باشد', path: ['value'] })
    .refine(dateOrderOk, { message: 'تاریخ شروع باید قبل از تاریخ پایان باشد', path: ['validUntil'] }),
};

export const couponIdParamsSchema = {
  params: z.object({ id: objectId }),
};

export const setCouponStatusSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ isActive: z.boolean() }),
};

export const listCouponsSchema = {
  query: z.object({
    search: z.string().trim().max(100).optional(),
    campaign: z.enum(COUPON_CAMPAIGN_TYPES as [string, ...string[]]).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
};

/** Customer-facing: preview a coupon for a prospective booking. */
export const validateCouponSchema = {
  body: z
    .object({
      code: z.string().trim().min(1, 'کد لازم است').max(30),
      stylistId: objectId,
      serviceId: objectId.optional(),
      serviceIds: z.array(objectId).min(1).optional(),
      date: dateStr,
      startTime: hhmm,
      companionsCount: z.number().int().min(0).optional(),
      // Compute the preview after any valid stylist-owned discount as well.
      discountCode: z.string().trim().min(1).max(32).optional(),
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
