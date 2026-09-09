import { z } from 'zod';

export const claimReferralSchema = {
  body: z.object({
    // A referrer's code (trimmed; uppercased server-side).
    code: z.string().trim().min(1).max(32),
  }),
};