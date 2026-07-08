/**
 * Centralized finance calculations — the SINGLE source of truth for all
 * deposit, booking-fee, refund, and payable-on-site math.
 *
 * Every money-moving path in the system MUST go through this service so
 * the business rules are never duplicated or inconsistent.
 */
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

  // Tiered deposit percentage
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

/**
 * Booking fee tiered by final price (moved from frontend to backend).
 * This covers gateway + platform costs.
 */
export function calculateBookingFee(price: number): number {
  const p = Math.max(0, price);
  if (p <= 200_000) return 10_000;
  if (p <= 500_000) return 15_000;
  if (p <= 1_000_000) return 20_000;
  return 25_000;
}

/**
 * Calculate the actual refund amount from a deposit, given the refund percent.
 * The refund is ALWAYS based on the deposit (what the customer actually paid),
 * NOT the full service price.
 */
export function calculateRefund(depositAmount: number, refundPercent: number): number {
  return Math.round((depositAmount * Math.min(100, Math.max(0, refundPercent))) / 100);
}

/**
 * Calculate the penalty amount (deposit retained) given the penalty percent.
 */
export function calculatePenalty(depositAmount: number, penaltyPercent: number): number {
  return Math.round((depositAmount * Math.min(100, Math.max(0, penaltyPercent))) / 100);
}

/**
 * Format the deposit breakdown for API responses.
 */
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
