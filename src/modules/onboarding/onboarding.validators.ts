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
  body: z.object({
    firstName: z.string().trim().min(1, 'firstName is required').max(50),
    lastName: z.string().trim().min(1, 'lastName is required').max(50),
    nationalCode: z
      .string()
      .trim()
      .refine(isValidNationalCode, 'Invalid national code'),
    birthDate: z.coerce
      .date()
      .refine((d) => d.getTime() < Date.now(), 'birthDate must be in the past')
      .refine(
        (d) => d.getTime() > Date.now() - 120 * 365 * 24 * 60 * 60 * 1000,
        'birthDate is not realistic',
      ),
  }),
};
