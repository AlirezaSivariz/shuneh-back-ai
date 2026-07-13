/**
 * Centralized finance calculations — the SINGLE source of truth for all
 * deposit, booking-fee, refund, penalty, and debt math.
 *
 * Every money-moving path in the system MUST go through this service so
 * the business rules are never duplicated or inconsistent.
 */
import { IFinancialAdjustment, AdjustmentType } from '../../models/Reservation';

// ── Deposit / Booking Fee / Payable-on-Site ─────────────────────────────────

export interface DepositBreakdown {
  /** The deposit the customer pays online right now */
  depositAmount: number;
  /** The service-price-based deposit before min/max clamps */
  rawDeposit: number;
  /** Booking fee charged alongside the deposit */
  bookingFee: number;
  /** Total amount charged at booking time (deposit + fee) */
  totalCharge: number;
  /** Remaining amount the customer pays on-site */
  payableOnSite: number;
  /** Full service price (after discount) */
  price: number;
}

/**
 * Calculate the deposit amount and all derived financials for a given price.
 * The price should be the net price after any discount is applied.
 */
export function calculateDeposit(price: number): DepositBreakdown {
  const p = Math.max(0, price);

  let depositPercent: number;
  if (p < 100_000) {
    depositPercent = 50;
  } else if (p <= 300_000) {
    depositPercent = 30;
  } else {
    depositPercent = 20;
  }

  const rawDeposit = Math.round((p * depositPercent) / 100);
  const MIN_DEPOSIT = 30_000;
  const MAX_DEPOSIT = 500_000;
  const depositAmount = Math.min(MAX_DEPOSIT, Math.max(MIN_DEPOSIT, rawDeposit));

  const bookingFee = calculateBookingFee(p);
  const totalCharge = depositAmount + bookingFee;
  const payableOnSite = Math.max(0, p - depositAmount);

  return { depositAmount, rawDeposit, bookingFee, totalCharge, payableOnSite, price: p };
}

export function calculateBookingFee(price: number): number {
  const p = Math.max(0, price);
  if (p <= 200_000) return 10_000;
  if (p <= 500_000) return 15_000;
  if (p <= 1_000_000) return 20_000;
  return 25_000;
}

// ── Refund / Penalty helpers ────────────────────────────────────────────────

export function calculateRefund(depositAmount: number, refundPercent: number): number {
  return Math.round((depositAmount * Math.min(100, Math.max(0, refundPercent))) / 100);
}

export function calculatePenalty(depositAmount: number, penaltyPercent: number): number {
  return Math.round((depositAmount * Math.min(100, Math.max(0, penaltyPercent))) / 100);
}

// ── Financial Adjustment Helpers ────────────────────────────────────────────

export function makeAdjustment(
  type: AdjustmentType,
  label: string,
  amount: number,
  direction: 'debit' | 'credit',
  reason: string,
  status: 'pending' | 'applied' | 'settled' = 'applied',
): IFinancialAdjustment {
  return { type, label, amount, direction, reason, status, createdAt: new Date() };
}

// ── Net Settlement Computation ─────────────────────────────────────────────

export interface FinanceComputation {
  /** Total deposit (debit). */
  totalDeposit: number;
  /** Booking fee (debit). */
  totalBookingFee: number;
  /** Total paid online = deposit + booking fee. */
  totalPaidOnline: number;
  /** Payable on site (what the customer still owes at the salon). */
  payableOnSite: number;
  /** Sum of all penalty-type adjustments (debit). */
  totalPenalties: number;
  /** Sum of all refund-type adjustments (credit) — the gross refund. */
  grossRefund: number;
  /**
   * Final refund after applying penalties:
   *   if totalPenalties >= grossRefund → 0
   *   else → grossRefund - totalPenalties
   */
  netRefund: number;
  /**
   * Debt created when totalPenalties > grossRefund:
   *   max(0, totalPenalties - grossRefund)
   */
  debt: number;
  /** Net amount payable to stylist: totalDeposit - totalBookingFee - netRefund */
  netStylistShare: number;
  /** Detailed breakdown per adjustment for the invoice. */
  adjustments: IFinancialAdjustment[];
  /** Penalty details grouped by type. */
  penaltyDetails: { type: AdjustmentType; label: string; amount: number }[];
}

/**
 * Compute the final financial settlement from a set of adjustments.
 * This is the single source of truth for ALL financial math.
 *
 * @param adjustments  The financial adjustments to compute against.
 * @param servicePrice Optional service price. When provided, `payableOnSite`
 *   is computed correctly as `(servicePrice - totalDeposit) + totalPenalties`.
 *   Without it, only `payable_on_site` credit adjustments are summed (legacy).
 * @param isActive     Whether the reservation is active (not cancelled/no_show).
 *   When false, `payableOnSite` is forced to 0.
 */
export function computeFinance(
  adjustments: IFinancialAdjustment[],
  servicePrice?: number,
  isActive = true,
): FinanceComputation {
  const totalDeposit = sumByType(adjustments, 'deposit', 'debit');
  const totalBookingFee = sumByType(adjustments, 'booking_fee', 'debit');
  const totalPaidOnline = totalDeposit + totalBookingFee;
  const rawPayableOnSite = sumByType(adjustments, 'payable_on_site', 'credit');

  // Penalties: all penalty_* types with debit direction.
  const penaltyTypes: AdjustmentType[] = [
    'penalty_reschedule',
    'penalty_cancellation',
    'penalty_no_show',
    'penalty_policy_violation',
  ];
  const totalPenalties = penaltyTypes.reduce(
    (sum, t) => sum + sumByType(adjustments, t, 'debit'),
    0,
  );

  // Gross refund: sum of all refund-type credits.
  const grossRefund = sumByType(adjustments, 'refund', 'credit');

  // Net settlement.
  let netRefund: number;
  let debt: number;
  if (totalPenalties >= grossRefund) {
    netRefund = 0;
    debt = totalPenalties - grossRefund;
  } else {
    netRefund = grossRefund - totalPenalties;
    debt = 0;
  }

  // Penalty details for the invoice.
  const penaltyDetails = penaltyTypes
    .map((t) => {
      const amount = sumByType(adjustments, t, 'debit');
      return amount > 0
        ? { type: t, label: labelForType(t), amount }
        : null;
    })
    .filter((x): x is { type: AdjustmentType; label: string; amount: number } => x !== null);

  // Correct payable-on-site: remaining service balance + total penalties.
  const payableOnSite = !isActive
    ? 0
    : servicePrice != null
      ? Math.max(0, servicePrice - totalDeposit + totalPenalties)
      : rawPayableOnSite;

  // Net amount payable to stylist:
  // Only the deposit collected from customer goes to stylist.
  // Penalties are on customer's invoice, NOT subtracted from stylist.
  // Refunds are also not subtracted (handled separately).
  const netStylistShare = totalDeposit;

  return {
    totalDeposit,
    totalBookingFee,
    totalPaidOnline,
    payableOnSite,
    totalPenalties,
    grossRefund,
    netRefund,
    debt,
    netStylistShare,
    adjustments,
    penaltyDetails,
  };
}

function sumByType(
  adjustments: IFinancialAdjustment[],
  type: AdjustmentType,
  direction: 'debit' | 'credit',
): number {
  return adjustments
    .filter((a) => a.type === type && a.direction === direction)
    .reduce((s, a) => s + a.amount, 0);
}

function labelForType(type: AdjustmentType): string {
  const labels: Record<AdjustmentType, string> = {
    deposit: 'بیعانه',
    booking_fee: 'هزینه پردازش',
    payable_on_site: 'قابل پرداخت در محل',
    penalty_reschedule: 'جریمه جابجایی',
    penalty_cancellation: 'جریمه لغو',
    penalty_no_show: 'جریمه عدم حضور',
    penalty_policy_violation: 'جریمه نقض سیاست',
    refund: 'بازگشت وجه',
    debt: 'بدهی',
    adjustment: 'تسویه',
  };
  return labels[type] ?? type;
}

export function serializeDeposit(breakdown: DepositBreakdown) {
  return {
    price: breakdown.price,
    depositAmount: breakdown.depositAmount,
    rawDeposit: breakdown.rawDeposit,
    bookingFee: breakdown.bookingFee,
    totalCharge: breakdown.totalCharge,
    payableOnSite: breakdown.payableOnSite,
  };
}

export { labelForType };
