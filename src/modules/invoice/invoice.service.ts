import { Types } from 'mongoose';
import { Reservation } from '../../models/Reservation';
import { Service } from '../../models/Service';
import { StylistSettlement } from '../../models/StylistSettlement';
import { PaymentTransaction } from '../../models/PaymentTransaction';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { resolveCancellationPolicy, serializePolicy } from '../policy/policy.service';
import { computeFinance, labelForType } from '../finance/finance.service';
import type { AdjustmentType } from '../../models/Reservation';

export async function getReservationInvoice(
  userId: string,
  reservationId: string,
  viewer: 'customer' | 'stylist' | 'admin' = 'customer',
) {
  if (!Types.ObjectId.isValid(reservationId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }

  const reservation = await Reservation.findById(reservationId);
  if (!reservation) {
    throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');
  }
  if (
    String(reservation.customerId) !== userId &&
    String(reservation.stylistId) !== userId &&
    !['admin'].includes(viewer)
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

  const price = reservation.finalPrice ?? reservation.price ?? 0;
  const depositAmount = reservation.deposit?.amount ?? 0;

  const resolved = await resolveCancellationPolicy({
    stylistId: String(reservation.stylistId),
    salonId: reservation.salonId ? String(reservation.salonId) : null,
    serviceIds: serviceIds.map(String),
  });

  const isActive = !['cancelled', 'no_show'].includes(reservation.status);
  const finance = computeFinance(reservation.financialAdjustments ?? [], price, isActive);

  const paymentTx = reservation.paymentTxId
    ? await PaymentTransaction.findById(reservation.paymentTxId)
        .select('amountToman refNumber paidAt status purpose')
        .lean()
    : null;

  const customerUser = await User.findById(reservation.customerId)
    .select('debtBalance isDebtLocked')
    .lean();

  // Build grouped penalty details with count.
  const penaltyTypes: AdjustmentType[] = [
    'penalty_reschedule',
    'penalty_cancellation',
    'penalty_no_show',
    'penalty_policy_violation',
  ];

  const allAdjustments = (reservation.financialAdjustments ?? []).map((a) => ({
    type: a.type,
    label: labelForType(a.type),
    amount: a.amount,
    direction: a.direction,
    reason: a.reason,
    createdAt: a.createdAt instanceof Date ? a.createdAt.toISOString() : String(a.createdAt),
  }));

  const penaltyDetails = penaltyTypes
    .map((t) => {
      const items = allAdjustments.filter((a) => a.type === t && a.direction === 'debit');
      const total = items.reduce((s, i) => s + i.amount, 0);
      return total > 0
        ? {
            type: t,
            label: labelForType(t),
            amount: total,
            count: items.length,
            items: items.map((i) => ({ reason: i.reason, amount: i.amount })),
          }
        : null;
    })
    .filter((x) => x !== null);

  const debtAdj = allAdjustments.filter((a) => a.type === 'debt');

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

  // Policy violation info.
  let policyViolation: {
    type: string;
    reason: string;
    penaltyPercent: number;
    penaltyAmount: number;
    appliedPolicy: string;
  } | null = null;

  if (reservation.status === 'cancelled') {
    const outcome = reservation.cancellationOutcome;
    if (outcome && outcome.source) {
      const cancelPenaltyDetail = penaltyDetails.find((p) => p.type === 'penalty_cancellation');
      if (cancelPenaltyDetail) {
        policyViolation = {
          type: 'cancellation',
          reason: `لغو نوبت ${outcome.hoursBeforeStart} ساعت قبل از شروع`,
          penaltyPercent: outcome.penaltyPercent,
          penaltyAmount: cancelPenaltyDetail.amount,
          appliedPolicy: outcome.source,
        };
      }
    }
  }

  // Related transactions.
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

  const base = {
    reservationId: String(reservation._id),
    status: reservation.status,
    services: svcNames,
    view: viewer,
    price,
    discount: reservation.discountCode
      ? { code: reservation.discountCode, amount: reservation.discountAmount ?? 0 }
      : null,
    deposit: {
      amount: finance.totalDeposit,
      bookingFee: finance.totalBookingFee,
      totalPaidOnline: finance.totalPaidOnline,
    },
    payableOnSite: finance.payableOnSite,
    totalPenalties: finance.totalPenalties,
    grossRefund: finance.grossRefund,
    netRefund: finance.netRefund,
    debt: finance.debt,
    customerDebtBalance: customerUser?.debtBalance ?? 0,
    customerDebtLocked: customerUser?.isDebtLocked ?? false,
    siteFee: finance.totalBookingFee,
    penaltyDetails,
    details: {
      adjustments: viewer === 'admin' ? allAdjustments : [],
      policy: serializePolicy(resolved),
      policyViolation,
      rescheduleHistory,
      rescheduleCount: reservation.rescheduleCount ?? 0,
      maxReschedules: reservation.maxReschedules ?? 2,
      relatedTransactions: relatedTransactions.sort(
        (a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime(),
      ),
    },
  };

  return base;
}
