import { z } from 'zod';

/** Sane top-up bounds (whole Toman): 10,000 .. 500,000,000. */
const MIN_TOPUP = 10_000;
const MAX_TOPUP = 500_000_000;

export const topupSchema = {
  body: z.object({
    amount: z
      .number()
      .int('مبلغ باید عدد صحیح باشد')
      .min(MIN_TOPUP, `حداقل مبلغ افزایش موجودی ${MIN_TOPUP.toLocaleString('en-US')} تومان است`)
      .max(MAX_TOPUP, 'مبلغ واردشده بیش از حد مجاز است'),
  }),
};

export const walletTxListSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
};
