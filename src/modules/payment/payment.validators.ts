import { z } from 'zod';

/** Gateway floor is 1,000 Rial = 100 Toman; cap mirrors the wallet top-up cap. */
const MIN_PAY_TOMAN = 100;
const MAX_PAY_TOMAN = 500_000_000;

/**
 * POST /payments/zibal/request — generic gateway start. Amount is whole **Toman**
 * (the backend multiplies by 10 before calling Zibal). `orderId`/`description`/
 * `mobile` are optional caller context echoed to Zibal / back on the callback.
 */
export const zibalRequestSchema = {
  body: z.object({
    amount: z
      .number()
      .int('مبلغ باید عدد صحیح باشد')
      .min(MIN_PAY_TOMAN, `حداقل مبلغ قابل پرداخت ${MIN_PAY_TOMAN.toLocaleString('en-US')} تومان است`)
      .max(MAX_PAY_TOMAN, 'مبلغ واردشده بیش از حد مجاز است'),
    orderId: z.string().trim().max(120).optional(),
    description: z.string().trim().max(255).optional(),
    mobile: z
      .string()
      .regex(/^09\d{9}$/, 'شماره موبایل نامعتبر است')
      .optional(),
  }),
};

/** POST /payments/plan — buy a subscription tier online. Price is server-derived. */
export const planPurchaseSchema = {
  body: z.object({
    tier: z.enum(['silver', 'gold'], {
      errorMap: () => ({ message: 'پلن انتخابی نامعتبر است' }),
    }),
  }),
};

/**
 * Zibal's callback comes back on our route as query params. It is a browser
 * redirect from an EXTERNAL service, so we validate leniently (all optional,
 * coerced to string) and never 400 the user — the controller resolves any
 * problem to the frontend failure page instead.
 */
export const callbackSchema = {
  query: z.object({
    trackId: z.coerce.string().optional(),
    success: z.coerce.string().optional(),
    status: z.coerce.string().optional(),
    orderId: z.coerce.string().optional(),
  }),
};
