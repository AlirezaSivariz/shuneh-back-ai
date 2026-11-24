/**
 * The single cancellation-finance builder shared by customer, stylist and
 * admin cancellation paths. Every path must create the same refund / penalty /
 * debt adjustments so policy math cannot drift between roles.
 */
import type { IFinancialAdjustment } from '../../models/Reservation';
import {
  calculatePenalty,
  calculateRefund,
  computeFinance,
  makeAdjustment,
  FinanceComputation,
} from './finance.service';
import {
  computeCancellationOutcome,
  CancellationOutcome,
  ResolvedPolicy,
} from '../policy/policy.service';

export type CancellationActor = 'customer' | 'stylist' | 'admin';

export interface BuildCancellationFinanceInput {
  existingAdjustments: IFinancialAdjustment[];
  resolved: ResolvedPolicy;
  startAt: Date;
  /** What the customer actually paid online (for the policy percentages). */
  paidAmount: number;
  /** Deposit used for the Toman amounts. */
  depositAmount: number;
  actor: CancellationActor;
  now?: Date;
}

export interface CancellationFinanceResult {
  /** Refund / penalty / debt adjustments to append to the reservation. */
  newAdjustments: IFinancialAdjustment[];
  finance: FinanceComputation;
  outcome: CancellationOutcome;
  /** Positive when penalties exceed refunds and must be posted as customer debt. */
  debtCreated: number;
}

const ACTOR_LABEL: Record<CancellationActor, string> = {
  customer: 'لغو توسط مشتری',
  stylist: 'لغو توسط متخصص',
  admin: 'لغو توسط پشتیبانی',
};

export function buildCancellationFinance(
  input: BuildCancellationFinanceInput,
): CancellationFinanceResult {
  const outcome = computeCancellationOutcome(
    input.resolved,
    input.startAt,
    input.paidAmount,
    input.now,
  );
  const grossRefund = calculateRefund(input.depositAmount, outcome.refundPercent);
  const cancelPenalty = calculatePenalty(
    input.depositAmount,
    outcome.penaltyPercent,
  );
  const prefix = ACTOR_LABEL[input.actor];
  const timing = `(${outcome.hoursBeforeStart} ساعت قبل از شروع)`;
  const newAdjustments: IFinancialAdjustment[] = [];

  if (grossRefund > 0) {
    newAdjustments.push(
      makeAdjustment(
        'refund',
        'بازگشت وجه',
        grossRefund,
        'credit',
        `${prefix} ${timing} — ${outcome.refundPercent}٪ بازگشت`,
      ),
    );
  }
  if (cancelPenalty > 0) {
    newAdjustments.push(
      makeAdjustment(
        'penalty_cancellation',
        'جریمه لغو',
        cancelPenalty,
        'debit',
        `${prefix} ${timing} — ${outcome.penaltyPercent}٪ جریمه`,
      ),
    );
  }

  // `computeFinance` nets penalties against refunds and reports any shortfall.
  const finance = computeFinance([
    ...input.existingAdjustments,
    ...newAdjustments,
  ]);
  if (finance.debt > 0) {
    newAdjustments.push(
      makeAdjustment(
        'debt',
        'بدهی',
        finance.debt,
        'debit',
        `مازاد جریمهها بر بازگشت وجه (${finance.totalPenalties.toLocaleString('fa')} - ${finance.grossRefund.toLocaleString('fa')})`,
      ),
    );
  }

  return {
    newAdjustments,
    finance,
    outcome,
    debtCreated: finance.debt,
  };
}
