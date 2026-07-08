import { Types } from 'mongoose';
import { Reservation } from '../../models/Reservation';
import { Service } from '../../models/Service';
import { StylistSettlement } from '../../models/StylistSettlement';
import { PaymentTransaction } from '../../models/PaymentTransaction';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { resolveCancellationPolicy, serializePolicy } from '../policy/policy.service';
import { calculateDeposit, calculateRefund, calculatePenalty } from '../finance/finance.service';

/**
 * Generate a comprehensive invoice for a reservation. Accessible to both
 * the customer and the stylist who own the reservation.
 */
export async function getReservationInvoice(userId: string, reservationId: string) {
  if (!Types.ObjectId.isValid(reservationId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }

  const reservation = await Reservation.findById(reservationId);
  if (!reservation) {
    throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');
  }
  if (
    String(reservation.customerId) !== userId &&
    String(reservation.stylistId) !== userId
  ) {
    throw AppError.forbidden('دسترسی غیرمجاز', 'FORBIDDEN');
  }

  const serviceIds = reservation.serviceIds?.length
    ? reservation.serviceIds
    : [reservation.serviceId];
  const services = await Service.find({ _id: { $in: serviceIds } })
    .select('name')
    .lean();
  const svcNames = services.map((s) => s.name);

  // Resolve current policy for display.
  const resolved = await resolveCancellationPolicy({
    stylistId: String(reservation.stylistId),
    salonId: reservation.salonId ? String(reservation.salonId) : null,
    serviceIds: serviceIds.map(String),
  });

  // Financial breakdown.
  const price = reservation.finalPrice ?? reservation.price ?? 0;
  const deposit = reservation.deposit;
  const depositAmount = deposit?.amount ?? price; // fallback for legacy rows
  const bookingFee = deposit?.bookingFee ?? 0;
  const totalPaidOnline = deposit?.totalCharge ?? price;
  const payableOnSite = deposit?.payableOnSite ?? 0;

  // Related payment transaction.
  const paymentTx = reservation.paymentTxId
    ? await PaymentTransaction.findById(reservation.paymentTxId)
        .select('amountToman refNumber paidAt status purpose')
        .lean()
    : null;

  // Cancellation/refund info.
  let refundInfo = null;
  let penaltyInfo = null;
  let policyViolation = null;

  if (reservation.status === 'cancelled') {
    const outcome = reservation.cancellationOutcome;
    if (outcome) {
      const actualRefund = calculateRefund(depositAmount, outcome.refundPercent);
      const actualPenalty = calculatePenalty(depositAmount, outcome.penaltyPercent);
      refundInfo = {
        refundPercent: outcome.refundPercent,
        refundAmount: actualRefund,
        source: outcome.source,
      };
      penaltyInfo = {
        penaltyPercent: outcome.penaltyPercent,
        penaltyAmount: actualPenalty,
      };
    }
  }

  // Policy violation detection.
  if (reservation.status === 'cancelled') {
    const outcome = reservation.cancellationOutcome;
    if (outcome && outcome.penaltyPercent > 0) {
      policyViolation = {
        type: 'cancellation',
        reason: `لغو نوبت ${outcome.hoursBeforeStart} ساعت قبل از شروع`,
        penaltyPercent: outcome.penaltyPercent,
        penaltyAmount: outcome.penaltyAmount ?? (depositAmount * outcome.penaltyPercent) / 100,
        appliedPolicy: outcome.source,
      };
    }
  }

  // Reschedule policy check.
  const rescheduleHistory = (reservation.rescheduleHistory ?? []).map((h) => ({
    fromDate: h.fromDate,
    fromStartTime: h.fromStartTime,
    toDate: h.toDate,
    toStartTime: h.toStartTime,
    by: h.by,
    at: h.at instanceof Date ? h.at.toISOString() : String(h.at),
    free: h.free ?? true,
    penaltyAmount: h.penaltyAmount ?? null,
  }));

  const penalizedReschedules = rescheduleHistory.filter((h) => !h.free);
  if (penalizedReschedules.length > 0) {
    policyViolation = {
      ...(policyViolation ?? {}),
      type: 'reschedule',
      reason: 'جابه‌جایی با جریمه',
      penaltyPercent: resolved.policy.reschedulePenaltyPercent,
      penaltyAmount: penalizedReschedules.reduce((s, h) => s + (h.penaltyAmount ?? 0), 0),
      appliedPolicy: resolved.source,
    };
  }

  // Related transactions (payment + settlements).
  const relatedTransactions: Array<{
    type: string;
    amount: number;
    status: string;
    createdAt: string;
    refNumber?: string | null;
  }> = [];

  if (paymentTx) {
    relatedTransactions.push({
      type: 'payment',
      amount: paymentTx.amountToman,
      status: paymentTx.status,
      createdAt: paymentTx.paidAt
        ? new Date(paymentTx.paidAt).toISOString()
        : String(paymentTx._id),
      refNumber: paymentTx.refNumber,
    });
  }

  // Check if any settlement covers this reservation.
  const settlements = await StylistSettlement.find({
    depositReservationIds: reservation._id,
  })
    .select('amount status createdAt')
    .lean();

  for (const s of settlements) {
    relatedTransactions.push({
      type: 'settlement',
      amount: s.amount,
      status: s.status,
      createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : String(s.createdAt),
    });
  }

  // Site fee = booking fee (our platform fee).
  const siteFee = bookingFee;

  return {
    reservationId: String(reservation._id),
    status: reservation.status,
    price,
    discount: reservation.discountCode
      ? {
          code: reservation.discountCode,
          amount: reservation.discountAmount ?? 0,
        }
      : null,
    services: svcNames,
    deposit: {
      amount: depositAmount,
      bookingFee,
      totalPaidOnline,
      payableOnSite,
    },
    refund: refundInfo,
    penalty: penaltyInfo,
    siteFee,
    policy: serializePolicy(resolved),
    policyViolation,
    rescheduleHistory,
    relatedTransactions: relatedTransactions.sort(
      (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
    ),
  };
}
