import { z } from 'zod';

const phoneSchema = z
  .string()
  .trim()
  .regex(/^09\d{9}$/, 'Phone must be a valid Iranian mobile number (09xxxxxxxxx)');

export const requestOtpSchema = {
  body: z.object({
    phone: phoneSchema,
  }),
};

export const verifyOtpSchema = {
  body: z.object({
    phone: phoneSchema,
    code: z.string().trim().regex(/^\d{4,6}$/, 'OTP code must be 4-6 digits'),
  }),
};

export const refreshSchema = {
  body: z.object({
    refreshToken: z.string().min(10, 'refreshToken is required'),
  }),
};

export const logoutSchema = {
  body: z.object({
    refreshToken: z.string().min(10, 'refreshToken is required'),
  }),
};

export const passwordLoginSchema = {
  body: z.object({
    phone: phoneSchema,
    password: z.string().min(1, 'رمز عبور را وارد کنید'),
  }),
};

export const setPasswordSchema = {
  body: z
    .object({
      password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد'),
      confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: 'رمز عبور و تکرار آن مطابقت ندارند',
      path: ['confirmPassword'],
    }),
};

export const resetPasswordSchema = {
  body: z
    .object({
      phone: phoneSchema,
      code: z.string().trim().regex(/^\d{4,6}$/, 'OTP code must be 4-6 digits'),
      password: z.string().min(8, 'رمز عبور باید حداقل ۸ کاراکتر باشد'),
      confirmPassword: z.string(),
    })
    .refine((d) => d.password === d.confirmPassword, {
      message: 'رمز عبور و تکرار آن مطابقت ندارند',
      path: ['confirmPassword'],
    }),
};

export type RequestOtpInput = z.infer<typeof requestOtpSchema.body>;
export type VerifyOtpInput = z.infer<typeof verifyOtpSchema.body>;
