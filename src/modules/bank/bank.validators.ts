import { z } from 'zod';

export const updateBankInfoSchema = {
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
