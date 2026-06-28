import { z } from 'zod';
import { SELF_ASSIGNABLE_ROLES } from '../../models/User';
import { isValidNationalCode } from '../../utils/nationalCode';

export const setRolesSchema = {
  body: z.object({
    // Only self-assignable roles — 'admin' can never be granted this way.
    roles: z
      .array(z.enum(SELF_ASSIGNABLE_ROLES as [string, ...string[]]))
      .nonempty('At least one role is required'),
  }),
};

export const personalSchema = {
  body: z
    .object({
      firstName: z.string().trim().min(1, 'firstName is required').max(50),
      lastName: z.string().trim().min(1, 'lastName is required').max(50),
      // Iranian users send a valid nationalCode; foreign nationals instead set
      // isForeignNational + a 12-digit foreignId. Exactly one identity is required.
      isForeignNational: z.boolean().optional().default(false),
      nationalCode: z.string().trim().optional(),
      // Any non-empty value is accepted (no fixed length/format); uniqueness is
      // still enforced by the partial-unique index in the service layer.
      foreignId: z.string().trim().min(1).optional(),
      birthDate: z.coerce
        .date()
        .refine((d) => d.getTime() < Date.now(), 'birthDate must be in the past')
        .refine(
          (d) => d.getTime() > Date.now() - 120 * 365 * 24 * 60 * 60 * 1000,
          'birthDate is not realistic',
        ),
    })
    .superRefine((b, ctx) => {
      if (b.isForeignNational) {
        // Foreign: foreignId required, nationalCode must be absent.
        if (!b.foreignId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['foreignId'],
            message: 'کد اختصاصی ۱۲ رقمی الزامی است',
          });
        }
        if (b.nationalCode) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['nationalCode'],
            message: 'برای اتباع، کد ملی نباید وارد شود',
          });
        }
      } else {
        // Iranian: nationalCode required + valid, foreignId must be absent.
        if (!b.nationalCode || !isValidNationalCode(b.nationalCode)) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['nationalCode'],
            message: 'کد ملی معتبر نیست',
          });
        }
        if (b.foreignId) {
          ctx.addIssue({
            code: z.ZodIssueCode.custom,
            path: ['foreignId'],
            message: 'کد اختصاصی فقط برای اتباع است',
          });
        }
      }
    }),
};

/** A reviewed name-edit request (firstName/lastName only). */
export const nameEditSchema = {
  body: z.object({
    firstName: z.string().trim().min(2, 'نام را وارد کن').max(50),
    lastName: z.string().trim().min(2, 'نام خانوادگی را وارد کن').max(50),
  }),
};
