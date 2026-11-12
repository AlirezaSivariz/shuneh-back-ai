import { z } from 'zod';
import { AD_AUDIENCES } from '../../models/Advertisement';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'شناسه نامعتبر است');
const dateStr = z
  .string()
  .regex(/^\d{4}-\d{2}-\d{2}$/, 'تاریخ باید به فرمت YYYY-MM-DD باشد');

const destinationUrl = z
  .string()
  .trim()
  .min(1, 'نشانی مقصد لازم است')
  .max(2048)
  .refine(
    (value) =>
      /^https?:\/\//i.test(value) ||
      (value.startsWith('/') &&
        !value.startsWith('//') &&
        !value.includes('\\') &&
        !/%5c/i.test(value)),
    'نشانی مقصد باید با http(s):// یا / شروع شود',
  );

const viewerKey = z.string().trim().min(6).max(120).optional();

const baseFields = {
  title: z.string().trim().max(120).nullable().optional(),
  description: z.string().trim().max(500).nullable().optional(),
  image: z.string().trim().min(1, 'تصویر تبلیغ لازم است').max(500),
  destinationUrl,
  ctaText: z.string().trim().max(40).nullable().optional(),
  audience: z.enum(AD_AUDIENCES as [string, ...string[]]),
  startDate: dateStr.nullable().optional(),
  endDate: dateStr.nullable().optional(),
  isActive: z.boolean().optional(),
  displayIntervalMinutes: z.number().int().min(1).max(525_600).optional(),
  maxImpressionsPerUser: z.number().int().min(0).max(1_000_000).optional(),
  maxImpressionsTotal: z.number().int().min(0).max(1_000_000_000).optional(),
};

type Body = Record<string, unknown>;
const dateOrderOk = (b: Body) =>
  !(b.startDate && b.endDate) || (b.startDate as string) <= (b.endDate as string);

export const createAdvertisementSchema = {
  body: z
    .object(baseFields)
    .refine(dateOrderOk, {
      message: 'تاریخ شروع باید قبل از تاریخ پایان باشد',
      path: ['endDate'],
    }),
};

export const updateAdvertisementSchema = {
  params: z.object({ id: objectId }),
  body: z
    .object(baseFields)
    .partial()
    .refine((b) => Object.keys(b).length > 0, 'حداقل یک فیلد برای ویرایش لازم است')
    .refine(dateOrderOk, {
      message: 'تاریخ شروع باید قبل از تاریخ پایان باشد',
      path: ['endDate'],
    }),
};

export const advertisementIdParamsSchema = {
  params: z.object({ id: objectId }),
};

export const setAdvertisementStatusSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ isActive: z.boolean() }),
};

export const listAdvertisementsSchema = {
  query: z.object({
    search: z.string().trim().max(100).optional(),
    audience: z.enum(AD_AUDIENCES as [string, ...string[]]).optional(),
    isActive: z.enum(['true', 'false']).optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
  }),
};

export const nextAdvertisementSchema = {
  query: z.object({ viewer: viewerKey }),
};

export const impressionAdvertisementSchema = {
  params: z.object({ id: objectId }),
  body: z.object({ viewerKey }).default({}),
};

export const clickAdvertisementSchema = {
  params: z.object({ id: objectId }),
};
