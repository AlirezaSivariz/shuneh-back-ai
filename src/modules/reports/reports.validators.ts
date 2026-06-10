import { z } from 'zod';

const dateStr = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Date must be YYYY-MM-DD');

/** ?from=YYYY-MM-DD&to=YYYY-MM-DD (Gregorian; Iran timezone is fixed). */
export const reportRangeSchema = {
  query: z.object({
    from: dateStr,
    to: dateStr,
  }),
};
