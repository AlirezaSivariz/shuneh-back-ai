/**
 * Purchasable subscription plans and their price (whole Toman). The `free` tier
 * is the default and is never purchased. This is the SINGLE source of truth for
 * plan pricing — the plan-purchase endpoint and the gateway callback both read
 * it, so the amount charged always matches the tier granted.
 */
import type { PlanTier } from '../../models/StylistProfile';

export type PurchasablePlan = Exclude<PlanTier, 'free'>;

export const PLAN_PRICES_TOMAN: Record<PurchasablePlan, number> = {
  silver: 200_000,
  gold: 349_000,
};

export const PURCHASABLE_PLANS: PurchasablePlan[] = ['silver', 'gold'];

export function isPurchasablePlan(tier: unknown): tier is PurchasablePlan {
  return tier === 'silver' || tier === 'gold';
}
