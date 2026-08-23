import { z } from 'zod';
import { FEATURE_KEYS } from '../../models/UserFeatureOverride';

const featureKeyEnum = z.enum(FEATURE_KEYS as unknown as [string, ...string[]], {
  errorMap: () => ({ message: 'کلید ویژگی نامعتبر است' }),
});

export const listOverridesSchema = {
  query: z.object({
    userId: z.string().optional(),
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
};

export const userIdParamsSchema = {
  params: z.object({ userId: z.string().min(1) }),
};

export const createOverrideSchema = {
  body: z.object({
    userId: z.string().min(1, 'شناسه کاربر الزامی است'),
    featureKey: featureKeyEnum,
    enabled: z.boolean(),
  }),
};

export const overrideParamsSchema = {
  params: z.object({
    userId: z.string().min(1),
    featureKey: featureKeyEnum,
  }),
};
