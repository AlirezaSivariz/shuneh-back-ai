import { Schema } from 'mongoose';

/**
 * Shared cancellation/reschedule policy structure, embedded on the Salon (default),
 * the StylistProfile (own general policy + per-service gold policies) — see
 * `src/modules/policy`. Display + calculation only for now; NO money is moved
 * (there is no payment gateway yet). The structure is intentionally ready for a
 * future deposit/refund engine to consume.
 */
export interface ICancellationRule {
  /** Threshold: this rule applies when the remaining hours-to-start is ≥ this. */
  hoursBeforeStart: number;
  /** Percent of the paid amount refunded to the customer when this band applies. */
  refundPercent: number;
}

export interface ICancellationPolicy {
  /** Refund bands, evaluated highest-threshold-met-wins. Below the smallest → 0%. */
  rules: ICancellationRule[];
  /** How many reschedules are free before a penalty applies. */
  freeRescheduleCount: number;
  /** Penalty percent applied to a reschedule once the free count is exhausted. */
  reschedulePenaltyPercent: number;
}

export const cancellationRuleSchema = new Schema<ICancellationRule>(
  {
    hoursBeforeStart: { type: Number, required: true, min: 0, max: 720 },
    refundPercent: { type: Number, required: true, min: 0, max: 100 },
  },
  { _id: false },
);

export const cancellationPolicySchema = new Schema<ICancellationPolicy>(
  {
    rules: { type: [cancellationRuleSchema], default: [] },
    freeRescheduleCount: { type: Number, default: 1, min: 0, max: 10 },
    reschedulePenaltyPercent: { type: Number, default: 0, min: 0, max: 100 },
  },
  { _id: false },
);
