import { z } from 'zod';
import { CREDIT_TX_REASONS } from '../../models/CreditTransaction';

const objectId = z.string().regex(/^[a-f\d]{24}$/i, 'Invalid id');

export const walletQuerySchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(50).optional(),
  }),
};

export const planPurchaseSchema = {
  body: z.object({
    tier: z.enum(['silver', 'gold']),
  }),
};

export const creditSettingsUpdateSchema = {
  body: z.object({
    completedReservationCredit: z.number().int().min(0).optional(),
    fiveStarReviewCredit: z.number().int().min(0).optional(),
    consecutiveCancelPenalty: z.number().int().min(0).optional(),
    consecutiveCancelThreshold: z.number().int().min(1).optional(),
    silverCreditPrice: z.number().int().min(1).optional(),
    goldCreditPrice: z.number().int().min(1).optional(),
    isEnabled: z.boolean().optional(),
  }),
};

export const adminCreditAdjustSchema = {
  body: z.object({
    amount: z.number().int().min(1),
    description: z.string().trim().min(1).max(500),
  }),
  params: z.object({ id: objectId }),
};

export const adminListSchema = {
  query: z.object({
    page: z.coerce.number().int().min(1).optional(),
    limit: z.coerce.number().int().min(1).max(100).optional(),
    search: z.string().trim().max(100).optional(),
  }),
};
