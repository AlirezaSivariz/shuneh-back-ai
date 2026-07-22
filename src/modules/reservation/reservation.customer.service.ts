/**
 * Customer & stylist reservation operations (Phase 2).
 *
 * Bookings auto-confirm on creation. A reservation may be cancelled by the
 * customer only up to 2 hours before its start.
 */
import { Types } from 'mongoose';
import { Reservation, IReservation } from '../../models/Reservation';
import { Service, IService } from '../../models/Service';
import { StylistService } from '../../models/StylistService';
import { StylistProfile } from '../../models/StylistProfile';
import { WorkingHour } from '../../models/WorkingHour';
import { Salon, ISalon } from '../../models/Salon';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { toMinutes, overlaps, contains } from '../../utils/time';
import { iranWallClockToUtc } from '../../utils/timezone';
import { storageProvider } from '../../utils/storage';
import { effectivePrice, effectiveDuration } from '../stylist/public.service';
import { resolveActiveSalons } from '../stylist/bookability';
import { affectedReservationIds } from '../stylist/hoursReconcile';
import { isForeignRestricted } from '../../utils/foreignApproval';
import { resolveDiscountForBooking, consumeDiscount } from '../discount/discount.service';
import { config } from '../../config/env';
import { Tip } from '../../models/Tip';
import { notificationService } from '../../utils/notification';
import { paymentProvider } from '../../utils/payment';
import {
  resolveCancellationPolicy,
  computeCancellationOutcome,
  computeRescheduleOutcome,
  resolvePerServicePolicies,
  serializePolicy,
  ResolvedPolicy,
} from '../policy/policy.service';
import {
  calculateDeposit,
  calculateRefund,
  calculatePenalty,
  computeFinance,
  makeAdjustment,
  FinanceComputation,
} from '../finance/finance.service';
import type { IFinancialAdjustment } from '../../models/Reservation';
import { applyCancellationPenalty } from '../credit/credit.service';

const CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

/** The deposit amount the customer actually paid online (for refund/penalty math). */
function paidAmountOf(r: IReservation): number | null {
  if (r.deposit?.amount != null) return r.deposit.amount;
  return r.finalPrice ?? r.price ?? null;
}

/** The net deposit (minus booking fee) that accrues to the stylist. */
function stylistShare(r: IReservation): number {
  return (r.deposit?.amount ?? 0) - (r.deposit?.bookingFee ?? 0);
}

/** Resolve the cancellation policy that applies to a reservation. */
function resolvePolicyFor(r: IReservation): Promise<ResolvedPolicy> {
  const serviceIds = (r.serviceIds?.length ? r.serviceIds : [r.serviceId]).map(String);
  return resolveCancellationPolicy({
    stylistId: String(r.stylistId),
    salonId: r.salonId ? String(r.salonId) : null,
    serviceIds,
  });
}

interface CreateInput {
  stylistId: string;
  salonId?: string | null;
  serviceIds: string[];
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  discountCode?: string;
  customerNote?: string;
  /** Customer ticked the "I accept the cancellation/reschedule terms" box. */
  acceptedPolicy?: boolean;
  /** Number of companions (extra people). 0 = customer only. */
  companionsCount?: number;
}

function endTimeFrom(startTime: string, durationMin: number): string {
  const total = toMinutes(startTime) + durationMin;
  const h = Math.floor(total / 60);
  const m = total % 60;
  if (h > 23) throw AppError.badRequest('بازه‌ی انتخابی از پایان روز عبور می‌کند', 'SLOT_OUT_OF_RANGE');
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

export async function createReservation(customerId: string, input: CreateInput) {
  const { stylistId, serviceIds, date, startTime } = input;

  // A user cannot book themselves (even though one user may be both a stylist
  // and a customer — they may still book OTHER stylists).
  if (customerId === stylistId) {
    throw AppError.badRequest('نمی‌توانید برای خودتان رزرو ثبت کنید', 'SELF_BOOKING');
  }

  // A foreign customer awaiting admin approval cannot book yet.
  const customer = await User.findById(customerId)
    .select('isForeignNational foreignApprovalStatus debtBalance isDebtLocked')
    .lean();
  if (isForeignRestricted(customer)) {
    throw AppError.forbidden(
      'حساب شما در انتظار تأیید پشتیبانی است؛ پس از تأیید می‌توانید نوبت رزرو کنید.',
      'FOREIGN_NOT_APPROVED',
    );
  }
  // Debt-locked customer cannot book.
  if (customer?.isDebtLocked) {
    throw AppError.forbidden(
      `به دلیل بدهی معوق (${(customer.debtBalance ?? 0).toLocaleString('fa')} تومان)، امکان ثبت رزرو جدید وجود ندارد. لطفاً ابتدا با پشتیبانی جهت تسویه و رفع محدودیت تماس بگیرید.`,
      'DEBT_LOCKED',
    );
  }

  const profile = await StylistProfile.findOne({ userId: stylistId }).lean();
  if (!profile || profile.status !== 'active') {
    throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  }
  // A foreign stylist awaiting approval can't receive bookings either.
  const stylistUser = await User.findById(stylistId)
    .select('isForeignNational foreignApprovalStatus')
    .lean();
  if (isForeignRestricted(stylistUser)) {
    throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  }
  if (profile.isAcceptingReservations === false) {
    throw AppError.badRequest('این متخصص فعلاً رزرو نمی‌پذیرد', 'NOT_ACCEPTING_RESERVATIONS');
  }

  // The stylist must have at least one ACTIVE workplace:
  // - Freelancer (workplaceType === 'freelance') — location is optional
  // - Active membership in an active salon
  const { activeSalonIds } = await resolveActiveSalons(stylistId);
  const isFreelance = profile.workplaceType === 'freelance';
  if (activeSalonIds.length === 0 && !isFreelance) {
    throw AppError.badRequest(
      'این متخصص در حال حاضر محل کار فعالی برای رزرو ندارد',
      'NO_ACTIVE_WORKPLACE',
    );
  }

  // Resolve effective duration / price for the chosen services.
  const stylistServices = await StylistService.find({
    stylistId,
    serviceId: { $in: serviceIds },
  }).lean();
  if (stylistServices.length !== new Set(serviceIds).size) {
    throw AppError.badRequest('یک یا چند سرویس برای این متخصص موجود نیست', 'SERVICE_NOT_OFFERED');
  }
  const services = await Service.find({ _id: { $in: serviceIds } }).lean();
  const svcById = new Map(services.map((s) => [String(s._id), s as unknown as IService]));

  let totalDuration = 0;
  let totalPrice = 0;
  const items: { serviceId: Types.ObjectId; price: number; durationMin: number }[] = [];
  for (const ss of stylistServices) {
    const svc = svcById.get(String(ss.serviceId));
    if (!svc) continue;
    const itemDuration = effectiveDuration(ss.durationMin, svc);
    const itemPrice = effectivePrice(ss.price, svc);
    totalDuration += itemDuration;
    totalPrice += itemPrice;
    items.push({ serviceId: ss.serviceId, price: itemPrice, durationMin: itemDuration });
  }
  if (totalDuration <= 0) throw AppError.badRequest('مدت سرویس نامعتبر است', 'INVALID_DURATION');

  // Apply companions multiplier (each extra person adds the same service).
  const companionsCount = input.companionsCount ?? 0;
  const persons = 1 + companionsCount;
  totalDuration *= persons;
  totalPrice *= persons;

  const endTime = endTimeFrom(startTime, totalDuration);

  // Iran day → weekday.
  const dayDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dayDate.getTime())) throw AppError.badRequest('تاریخ نامعتبر است', 'INVALID_DATE');
  const dayOfWeek = dayDate.getUTCDay();

  // The slot must lie within a working interval for that weekday.
  const hours = await WorkingHour.find({ stylistId, dayOfWeek }).lean();
  const host = hours.find((h) =>
    contains({ start: h.start, end: h.end }, { start: startTime, end: endTime }),
  );
  if (!host) {
    throw AppError.badRequest('این بازه در ساعات کاری متخصص نیست', 'OUTSIDE_WORKING_HOURS');
  }
  const salonId = host.salonId ? String(host.salonId) : null;

  // The chosen slot must be at an ACTIVE workplace (active salon, or freelance).
  if (salonId) {
    if (!activeSalonIds.includes(salonId)) {
      throw AppError.badRequest('این متخصص در این سالن محل کار فعالی ندارد', 'SALON_NOT_ACTIVE');
    }
  } else if (!isFreelance) {
    throw AppError.badRequest(
      'این متخصص در حال حاضر محل کار فعالی برای رزرو ندارد',
      'NO_ACTIVE_WORKPLACE',
    );
  }

  // Must be in the future.
  const startAt = iranWallClockToUtc(dayDate, startTime);
  if (startAt.getTime() <= Date.now()) {
    throw AppError.badRequest('زمان انتخابی گذشته است', 'SLOT_IN_PAST');
  }

  // Slot must still be free (re-check at booking time).
  const dayReservations = await Reservation.find({
    stylistId,
    date: dayDate,
    status: { $in: ['pending', 'confirmed'] },
  }).lean();
  const clash = dayReservations.some((r) =>
    overlaps({ start: r.startTime, end: r.endTime }, { start: startTime, end: endTime }),
  );
  if (clash) {
    throw AppError.conflict('این زمان دیگر خالی نیست', 'SLOT_TAKEN');
  }

  // Optional discount code — re-validated server-side against the freshly
  // computed prices and the appointment's day/time. `price` stays GROSS; the
  // discount is captured in the snapshot fields (originalPrice/finalPrice).
  let discountSnapshot: Record<string, unknown> = {};
  let codeIdToConsume: Types.ObjectId | null = null;
  if (input.discountCode) {
    const resolved = await resolveDiscountForBooking(
      stylistId,
      input.discountCode,
      items,
      date,
      startTime,
    );
    codeIdToConsume = resolved.code._id;
    discountSnapshot = {
      discountCode: resolved.code.code,
      discountType: resolved.code.type,
      discountValue: resolved.code.value,
      discountAmount: resolved.discountAmount,
      originalPrice: resolved.originalPrice,
      finalPrice: resolved.finalPrice,
    };
  }

  // Optional customer note for the stylist (trimmed; length capped by Zod).
  const customerNote = input.customerNote?.trim() || null;

  // Record acceptance of the cancellation terms + snapshot the EXACT per-service
  // policies the customer agreed to (legal transparency).
  let policyAcceptedAt: Date | null = null;
  let acceptedPolicies: { serviceId: Types.ObjectId; policy: unknown }[] = [];
  if (input.acceptedPolicy) {
    policyAcceptedAt = new Date();
    const { services: perService } = await resolvePerServicePolicies({
      stylistId,
      salonId,
      serviceIds,
    });
    acceptedPolicies = perService.map((s) => ({
      serviceId: new Types.ObjectId(s.serviceId),
      policy: s.policy.policy,
    }));
  }

  // Deposit-only: charge a deposit (not the full price) plus a small booking fee.
  // The deposit model is computed by the centralized finance service.
  const netPrice = (discountSnapshot.finalPrice as number | undefined) ?? totalPrice;
  const depositBreakdown = calculateDeposit(netPrice);
  const chargeToman = depositBreakdown.totalCharge;
  const requiresPayment = config.paymentDriver === 'zibal' && chargeToman > 0;

  // Resolve policy to get maxRescheduleCount for this reservation.
  const policyForCreate = await resolveCancellationPolicy({
    stylistId,
    salonId,
    serviceIds,
  });
  const maxReschedules = policyForCreate.policy.maxRescheduleCount;

  // Create financial adjustments for the booking.
  const bookingAdjustments: IFinancialAdjustment[] = [
    makeAdjustment('deposit', 'بیعانه', depositBreakdown.depositAmount, 'debit', 'پرداخت بیعانه هنگام رزرو'),
    makeAdjustment('booking_fee', 'هزینه پردازش', depositBreakdown.bookingFee, 'debit', 'کارمزد پردازش رزرو'),
  ];
  if (depositBreakdown.payableOnSite > 0) {
    bookingAdjustments.push(
      makeAdjustment('payable_on_site', 'قابل پرداخت در محل', depositBreakdown.payableOnSite, 'credit', 'مبلغ قابل پرداخت در محل'),
    );
  }

  const reservation = await Reservation.create({
    customerId: new Types.ObjectId(customerId),
    stylistId: new Types.ObjectId(stylistId),
    salonId: salonId ? new Types.ObjectId(salonId) : null,
    serviceId: new Types.ObjectId(serviceIds[0]),
    serviceIds: serviceIds.map((s) => new Types.ObjectId(s)),
    items,
    date: dayDate,
    startTime,
    endTime,
    price: totalPrice,
    ...discountSnapshot,
    deposit: {
      amount: depositBreakdown.depositAmount,
      bookingFee: depositBreakdown.bookingFee,
      totalCharge: depositBreakdown.totalCharge,
      payableOnSite: depositBreakdown.payableOnSite,
    },
    customerNote,
    companionsCount,
    policyAcceptedAt,
    acceptedPolicies,
    status: requiresPayment ? 'pending' : 'confirmed',
    paymentStatus: requiresPayment ? 'awaiting' : 'not_required',
    financialAdjustments: bookingAdjustments,
    rescheduleCount: 0,
    maxReschedules,
  });

  // Concurrency guard (no DB transaction available on standalone Mongo): the
  // pre-create clash check has a race window where two parallel bookings can
  // both pass. After creating, re-check for OVERLAPPING active reservations;
  // among a conflicting set the row with the smallest _id (earliest) wins, and
  // every loser deletes itself. This deterministically leaves exactly one
  // booking per overlapping slot even under concurrency.
  const concurrent = await Reservation.find({
    stylistId,
    date: dayDate,
    status: { $in: ['pending', 'confirmed'] },
    _id: { $ne: reservation._id },
  })
    .select('_id startTime endTime')
    .lean();
  const loses = concurrent.some(
    (c) =>
      overlaps({ start: c.startTime, end: c.endTime }, { start: startTime, end: endTime }) &&
      String(c._id) < String(reservation._id),
  );
  if (loses) {
    await reservation.deleteOne().catch(() => {});
    throw AppError.conflict('این زمان دیگر خالی نیست', 'SLOT_TAKEN');
  }

  // Atomically consume usage AFTER the reservation exists, so the usage limit
  // can't be exceeded by concurrent bookings. If the cap was hit in the
  // meantime, undo the reservation and surface a clear error.
  if (codeIdToConsume) {
    try {
      await consumeDiscount(codeIdToConsume);
    } catch (err) {
      await reservation.deleteOne().catch(() => {});
      throw err;
    }
  }

  // Ensure the booker holds the 'customer' role (idempotent) — a multi-role user
  // (e.g. a stylist) booking for the first time becomes a customer too, so the
  // reservation shows in their customer panel and navigation treats them right.
  await User.updateOne({ _id: customerId }, { $addToSet: { roles: 'customer' } });

  // Payment-required booking: start the gateway payment and return its redirect
  // URL. The reservation stays a hold until the verified callback confirms it
  // (see `confirmPaidReservation`). No "new booking" notifications are sent yet —
  // they fire on payment success. If starting the payment fails, release the hold.
  if (requiresPayment) {
    try {
      const { startPayment } = await import('../payment/payment.service');
      const customerUser = await User.findById(customerId).select('phone').lean();
      const pay = await startPayment(customerId, {
        amountToman: chargeToman,
        purpose: 'reservation_deposit',
        orderId: String(reservation._id),
        description: 'پرداخت رزرو نوبت شونه',
        mobile: customerUser?.phone,
        meta: { reservationId: String(reservation._id) },
      });
      // Link the transaction to the hold (best-effort; the tx meta is authoritative).
      reservation.paymentTxId = new Types.ObjectId(pay.transactionId);
      await reservation.save();
      return {
        reservation: await serializeReservation(reservation),
        payment: {
          required: true as const,
          paymentUrl: pay.paymentUrl,
          trackId: pay.trackId,
          transactionId: pay.transactionId,
          amountToman: chargeToman,
        },
      };
    } catch (err) {
      // Roll back the hold so the slot is freed and the customer can retry.
      await reservation.deleteOne().catch(() => {});
      throw err;
    }
  }

  // Auto-confirmed booking (gateway off / free service): notify both parties.
  void sendReservationCreatedNotifications(reservation);

  return {
    reservation: await serializeReservation(reservation),
    payment: { required: false as const },
  };
}

/**
 * Notify the stylist + customer of a newly-confirmed booking (best-effort; never
 * blocks the caller). Used both on immediate auto-confirm and after a paid
 * reservation is confirmed on the gateway callback.
 */
async function sendReservationCreatedNotifications(reservation: IReservation): Promise<void> {
  const date = reservation.date.toISOString().slice(0, 10);
  const { startTime } = reservation;
  const [stylistUser, customerUser] = await Promise.all([
    User.findById(reservation.stylistId).select('phone').lean(),
    User.findById(reservation.customerId).select('phone').lean(),
  ]);
  if (stylistUser?.phone) {
    void notificationService.reservationCreated(stylistUser.phone, {
      date,
      startTime,
      audience: 'stylist',
      hasNote: !!reservation.customerNote,
    });
  }
  if (customerUser?.phone) {
    void notificationService.reservationCreated(customerUser.phone, {
      date,
      startTime,
      audience: 'customer',
    });
  }
}

/**
 * Confirm a reservation whose gateway payment just verified. Idempotent: only a
 * still-`awaiting` hold flips to a paid, confirmed booking (and triggers the
 * "new booking" notifications); a repeat/duplicate callback is a no-op.
 */
export async function confirmPaidReservation(
  reservationId: string,
  payment: { paymentTxId: string; refNumber?: string | null },
): Promise<void> {
  if (!Types.ObjectId.isValid(reservationId)) return;
  const reservation = await Reservation.findOneAndUpdate(
    { _id: reservationId, paymentStatus: 'awaiting' },
    {
      $set: {
        status: 'confirmed',
        paymentStatus: 'paid',
        paymentTxId: new Types.ObjectId(payment.paymentTxId),
        paymentRefNumber: payment.refNumber ?? null,
        paidAt: new Date(),
      },
    },
    { new: true },
  );
  if (!reservation) return; // already confirmed or released — nothing to do
  void sendReservationCreatedNotifications(reservation);
}

/**
 * Release the slot held by an unpaid reservation (payment failed / canceled).
 * Only deletes a still-`awaiting` hold, so a paid booking is never removed.
 */
export async function releaseUnpaidReservation(reservationId: string): Promise<void> {
  if (!Types.ObjectId.isValid(reservationId)) return;
  await Reservation.deleteOne({ _id: reservationId, paymentStatus: 'awaiting' });
}

/**
 * Sweep abandoned payment holds (customer left the gateway without returning).
 * Deletes `awaiting` holds older than `olderThanMinutes` so their slots free up.
 * The TTL comfortably exceeds a gateway session, so a late callback rarely loses
 * a booking.
 */
export async function releaseExpiredHolds(olderThanMinutes = 30): Promise<{ removed: number }> {
  const cutoff = new Date(Date.now() - olderThanMinutes * 60 * 1000);
  const result = await Reservation.deleteMany({
    paymentStatus: 'awaiting',
    createdAt: { $lt: cutoff },
  });
  return { removed: result.deletedCount ?? 0 };
}

type Filter = 'upcoming' | 'past' | undefined;

function filterQuery(base: Record<string, unknown>, filter: Filter) {
  const now = new Date();
  // Never surface unpaid holds (awaiting payment) as real bookings in any list.
  const visible = { ...base, paymentStatus: { $ne: 'awaiting' } };
  if (filter === 'upcoming') {
    return { ...visible, status: { $in: ['pending', 'confirmed'] }, startAt: { $gte: now } };
  }
  if (filter === 'past') {
    return {
      ...visible,
      $or: [{ status: { $in: ['completed', 'cancelled', 'no_show'] } }, { startAt: { $lt: now } }],
    };
  }
  return visible;
}

export async function listCustomerReservations(customerId: string, filter: Filter) {
  const reservations = await Reservation.find(filterQuery({ customerId }, filter)).sort({
    startAt: filter === 'past' ? -1 : 1,
  });
  return Promise.all(reservations.map((r) => serializeReservation(r)));
}

export async function listStylistReservations(stylistId: string, filter: Filter) {
  const reservations = await Reservation.find(filterQuery({ stylistId }, filter)).sort({
    startAt: filter === 'past' ? -1 : 1,
  });
  // Flag future reservations that an hours change pushed outside the stylist's
  // current working hours (computed once for the whole list).
  const affected = await affectedReservationIds(stylistId);
  return Promise.all(
    reservations.map((r) =>
      serializeReservation(r, 'stylist', { outOfHours: affected.has(String(r._id)) }),
    ),
  );
}

export async function getReservation(userId: string, reservationId: string) {
  if (!Types.ObjectId.isValid(reservationId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const reservation = await Reservation.findById(reservationId);
  if (!reservation) throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');
  if (String(reservation.customerId) !== userId && String(reservation.stylistId) !== userId) {
    throw AppError.forbidden('دسترسی غیرمجاز', 'FORBIDDEN');
  }
  return serializeReservation(reservation);
}

/**
 * Notify BOTH parties (customer + stylist) that a reservation was cancelled —
 * one SMS each, best-effort, never blocks the cancel. Used by every cancel path
 * (customer/stylist/admin) so neither side is ever left uninformed.
 */
function notifyReservationCancelled(
  reservation: { customerId: Types.ObjectId; stylistId: Types.ObjectId; date: Date; startTime: string },
  reason?: string | null,
) {
  void (async () => {
    const parties = await User.find({
      _id: { $in: [reservation.customerId, reservation.stylistId] },
    })
      .select('phone')
      .lean();
    for (const p of parties) {
      if (p.phone) {
        void notificationService.reservationCancelled(p.phone, {
          date: reservation.date.toISOString().slice(0, 10),
          startTime: reservation.startTime,
          reason: reason ?? undefined,
        });
      }
    }
  })();
}

/**
 * Apply a cancellation's financial adjustments to a reservation: create refund
 * and penalty adjustments, compute net result, and update customer debt.
 * Shared by customer and stylist cancel paths.
 */
async function applyCancellationFinance(
  reservation: IReservation,
  resolved: ResolvedPolicy,
  depositAmount: number,
  cancelledBy: 'customer' | 'stylist' | 'admin',
): Promise<{ debtCreated: number }> {
  const paidAmt = paidAmountOf(reservation) ?? depositAmount;
  const outcome = computeCancellationOutcome(resolved, reservation.startAt, paidAmt);
  const grossRefund = calculateRefund(depositAmount, outcome.refundPercent);
  const cancelPenalty = calculatePenalty(depositAmount, outcome.penaltyPercent);

  // Create the cancellation adjustments.
  const newAdjustments: IFinancialAdjustment[] = [];
  if (grossRefund > 0) {
    newAdjustments.push(
      makeAdjustment('refund', 'بازگشت وجه', grossRefund, 'credit', `لغو نوبت ${outcome.hoursBeforeStart} ساعت قبل از شروع (${outcome.refundPercent}٪ بازگشت)`),
    );
  }
  if (cancelPenalty > 0) {
    newAdjustments.push(
      makeAdjustment('penalty_cancellation', 'جریمه لغو', cancelPenalty, 'debit', `جریمه لغو ${outcome.hoursBeforeStart} ساعت قبل از شروع`),
    );
  }

  // Merge with existing adjustments and compute net.
  const allAdjustments = [...(reservation.financialAdjustments ?? []), ...newAdjustments];
  const finance = computeFinance(allAdjustments);

  // Create debt adjustment if penalties exceed refund.
  if (finance.debt > 0) {
    newAdjustments.push(
      makeAdjustment('debt', 'بدهی', finance.debt, 'debit', `مازاد جریمه‌ها بر بازگشت وجه (${finance.totalPenalties.toLocaleString('fa')} - ${finance.grossRefund.toLocaleString('fa')})`),
    );
  }

  // Snapshot the cancellation outcome.
  reservation.cancellationOutcome = {
    ...outcome,
    refundAmount: finance.netRefund,
    penaltyAmount: finance.totalPenalties,
    settled: false,
  };

  // Append new adjustments.
  reservation.financialAdjustments.push(...newAdjustments);
  reservation.status = 'cancelled';

  return { debtCreated: finance.debt };
}

export async function cancelReservation(customerId: string, reservationId: string) {
  if (!Types.ObjectId.isValid(reservationId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const reservation = await Reservation.findById(reservationId);
  if (!reservation) throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');
  if (String(reservation.customerId) !== customerId) {
    throw AppError.forbidden('دسترسی غیرمجاز', 'FORBIDDEN');
  }
  if (['cancelled', 'completed', 'no_show'].includes(reservation.status)) {
    throw AppError.badRequest('این رزرو قابل لغو نیست', 'NOT_CANCELLABLE');
  }
  if (reservation.startAt.getTime() - Date.now() < CANCEL_WINDOW_MS) {
    throw AppError.badRequest(
      'لغو رزرو فقط تا ۲ ساعت قبل از زمان نوبت ممکن است',
      'CANCEL_TOO_LATE',
    );
  }

  const depositAmount = reservation.deposit?.amount ?? 0;
  const resolved = await resolvePolicyFor(reservation);
  await applyCancellationFinance(reservation, resolved, depositAmount, 'customer');
  reservation.cancelledBy = 'customer';
  await reservation.save();

  notifyReservationCancelled(reservation);
  return serializeReservation(reservation);
}

/**
 * Cancel a reservation as the stylist who owns it. Only future 'confirmed'
 * reservations can be cancelled. Notifies the customer by SMS (non-blocking;
 * financial settlement — refunds/penalties — is intentionally left for later).
 */
export async function cancelByStylist(
  stylistId: string,
  reservationId: string,
  reason?: string | null,
) {
  if (!Types.ObjectId.isValid(reservationId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const reservation = await Reservation.findById(reservationId);
  if (!reservation) throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');
  if (String(reservation.stylistId) !== stylistId) {
    throw AppError.forbidden('فقط متخصص صاحب این رزرو می‌تواند آن را لغو کند', 'FORBIDDEN');
  }
  if (reservation.status !== 'confirmed') {
    throw AppError.badRequest(
      'فقط رزروهای تأییدشده قابل لغو هستند',
      'NOT_CANCELLABLE',
    );
  }
  if (reservation.startAt.getTime() <= Date.now()) {
    throw AppError.badRequest('رزرو گذشته قابل لغو نیست', 'RESERVATION_IN_PAST');
  }

  const depositAmount = reservation.deposit?.amount ?? 0;
  const resolvedS = await resolvePolicyFor(reservation);
  await applyCancellationFinance(reservation, resolvedS, depositAmount, 'stylist');
  reservation.cancelledBy = 'stylist';
  reservation.cancelReason = reason ?? null;
  await reservation.save();

  notifyReservationCancelled(reservation, reason);

  void applyCancellationPenalty(stylistId, reservationId);

  return serializeReservation(reservation, 'stylist');
}

/**
 * Reschedule a confirmed, future reservation to a new date/time. Works for the
 * reservation's OWN customer or stylist (the caller determines who). Services
 * stay the same; the SAME record is updated (rating/note/discount preserved).
 *
 * The new slot is validated with the same rules as booking (inside a working
 * interval that weekday → determines the possibly-different salon; future; no
 * overlap with OTHER active reservations). The reservation does not block
 * itself. Uses the same check-then-write anti-double-booking mechanism as
 * `createReservation` (a real DB transaction would need a replica set).
 */
export async function rescheduleReservation(
  userId: string,
  reservationId: string,
  input: { date: string; startTime: string },
) {
  if (!Types.ObjectId.isValid(reservationId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const reservation = await Reservation.findById(reservationId);
  if (!reservation) throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');

  const isStylistOwner = String(reservation.stylistId) === userId;
  const isCustomer = String(reservation.customerId) === userId;
  if (!isStylistOwner && !isCustomer) {
    throw AppError.forbidden('دسترسی غیرمجاز', 'FORBIDDEN');
  }
  const by: 'customer' | 'stylist' = isStylistOwner ? 'stylist' : 'customer';

  if (reservation.status !== 'confirmed') {
    throw AppError.badRequest('فقط نوبت‌های تأییدشده قابل جابه‌جایی هستند', 'NOT_RESCHEDULABLE');
  }
  if (reservation.startAt.getTime() <= Date.now()) {
    throw AppError.badRequest('نوبت گذشته قابل جابه‌جایی نیست', 'RESERVATION_IN_PAST');
  }

  const stylistId = String(reservation.stylistId);
  const { date, startTime } = input;

  // Preserve the original total duration (services unchanged).
  const totalDuration = toMinutes(reservation.endTime) - toMinutes(reservation.startTime);
  if (!(totalDuration > 0)) throw AppError.badRequest('مدت نوبت نامعتبر است', 'INVALID_DURATION');
  const endTime = endTimeFrom(startTime, totalDuration);

  const dayDate = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(dayDate.getTime())) throw AppError.badRequest('تاریخ نامعتبر است', 'INVALID_DATE');
  const dayOfWeek = dayDate.getUTCDay();

  // The new slot must lie within a working interval for that weekday. The host
  // interval determines the (possibly different) salon for the new day.
  const hours = await WorkingHour.find({ stylistId, dayOfWeek }).lean();
  const host = hours.find((h) =>
    contains({ start: h.start, end: h.end }, { start: startTime, end: endTime }),
  );
  if (!host) {
    throw AppError.badRequest('این بازه در ساعات کاری متخصص نیست', 'OUTSIDE_WORKING_HOURS');
  }
  const newSalonId = host.salonId ? String(host.salonId) : null;
  if (newSalonId) {
    // The new slot must be at an ACTIVE workplace (not pending/rejected/left).
    const { activeSalonIds } = await resolveActiveSalons(stylistId);
    if (!activeSalonIds.includes(newSalonId)) {
      throw AppError.badRequest('این متخصص در این سالن محل کار فعالی ندارد', 'SALON_NOT_ACTIVE');
    }
  }

  const newStartAt = iranWallClockToUtc(dayDate, startTime);
  if (newStartAt.getTime() <= Date.now()) {
    throw AppError.badRequest('زمان انتخابی گذشته است', 'SLOT_IN_PAST');
  }

  // No overlap with OTHER active reservations (this reservation excluded).
  const dayReservations = await Reservation.find({
    stylistId,
    date: dayDate,
    status: { $in: ['pending', 'confirmed'] },
    _id: { $ne: reservation._id },
  }).lean();
  const clash = dayReservations.some((r) =>
    overlaps({ start: r.startTime, end: r.endTime }, { start: startTime, end: endTime }),
  );
  if (clash) throw AppError.conflict('این زمان دیگر خالی نیست', 'SLOT_TAKEN');

  // Check reschedule limit: free plan = max 2, silver/gold = configurable.
  const currentReschedules = reservation.rescheduleCount ?? 0;
  const maxAllowed = reservation.maxReschedules ?? 2;
  if (maxAllowed >= 0 && currentReschedules >= maxAllowed) {
    throw AppError.badRequest(
      `حداکثر ${maxAllowed} بار جابه‌جایی برای این رزرو مجاز است. برای تغییر زمان، ابتدا نوبت را لغو کنید.`,
      'RESCHEDULE_LIMIT_REACHED',
    );
  }

  // Compute the reschedule penalty per the policy.
  const usedReschedules = reservation.rescheduleHistory?.length ?? 0;
  const resolvedR = await resolvePolicyFor(reservation);
  const rOut = computeRescheduleOutcome(resolvedR, usedReschedules, paidAmountOf(reservation));

  // Create penalty adjustment if the reschedule is not free.
  if (!rOut.free && rOut.penaltyAmount !== null && rOut.penaltyAmount > 0) {
    reservation.financialAdjustments.push(
      makeAdjustment(
        'penalty_reschedule',
        'جریمه جابجایی',
        rOut.penaltyAmount,
        'debit',
        `جابجایی ${by === 'customer' ? 'توسط مشتری' : 'توسط متخصص'} — ${rOut.penaltyPercent}٪ جریمه`,
      ),
    );
  }

  // Apply on the SAME record; append to history.
  const fromDate = reservation.date.toISOString().slice(0, 10);
  const fromStartTime = reservation.startTime;
  reservation.date = dayDate;
  reservation.startTime = startTime;
  reservation.endTime = endTime;
  reservation.salonId = newSalonId ? new Types.ObjectId(newSalonId) : null;
  reservation.rescheduleCount = currentReschedules + 1;
  reservation.rescheduleHistory = [
    ...(reservation.rescheduleHistory ?? []),
    {
      fromDate,
      fromStartTime,
      toDate: date,
      toStartTime: startTime,
      by,
      at: new Date(),
      free: rOut.free,
      penaltyPercent: rOut.penaltyPercent,
      penaltyAmount: rOut.penaltyAmount,
    },
  ];
  await reservation.save();

  // Notify BOTH parties (best-effort): the other side is informed and the actor
  // gets a confirmation.
  void (async () => {
    const parties = await User.find({
      _id: { $in: [reservation.customerId, reservation.stylistId] },
    })
      .select('phone')
      .lean();
    for (const p of parties) {
      if (p.phone) void notificationService.reservationRescheduled(p.phone, { date, startTime, by });
    }
  })();

  return serializeReservation(reservation, by === 'stylist' ? 'stylist' : 'customer');
}

/**
 * Preview the cancellation/reschedule consequences of a reservation WITHOUT
 * changing anything — the resolved policy + the refund/penalty that a cancel or
 * the next reschedule would incur right now. Used by the customer/stylist UI to
 * show the terms before they confirm. Owner (customer) or the stylist may view.
 */
export async function previewReservationPolicy(userId: string, reservationId: string) {
  if (!Types.ObjectId.isValid(reservationId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const reservation = await Reservation.findById(reservationId);
  if (!reservation) throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');
  if (String(reservation.customerId) !== userId && String(reservation.stylistId) !== userId) {
    throw AppError.forbidden('دسترسی غیرمجاز', 'FORBIDDEN');
  }

  const resolved = await resolvePolicyFor(reservation);
  const paid = paidAmountOf(reservation);
  const usedReschedules = reservation.rescheduleHistory?.length ?? 0;

  // Per-service breakdown (so the dialog can show differing policies clearly).
  const serviceIds = (reservation.serviceIds?.length ? reservation.serviceIds : [reservation.serviceId]).map(
    String,
  );
  const { uniform, services } = await resolvePerServicePolicies({
    stylistId: String(reservation.stylistId),
    salonId: reservation.salonId ? String(reservation.salonId) : null,
    serviceIds,
  });

  // Compute current financial state from adjustments.
  const rPrice = reservation.finalPrice ?? reservation.price ?? 0;
  const rActive = !['cancelled', 'no_show'].includes(reservation.status);
  const finance = computeFinance(reservation.financialAdjustments ?? [], rPrice, rActive);

  return {
    reservationId: String(reservation._id),
    status: reservation.status,
    paidAmount: paid,
    policy: serializePolicy(resolved),
    uniform,
    services: services.map((s) => ({
      serviceId: s.serviceId,
      serviceName: s.serviceName,
      policy: serializePolicy(s.policy),
    })),
    cancellation: computeCancellationOutcome(resolved, reservation.startAt, paid),
    reschedule: computeRescheduleOutcome(resolved, usedReschedules, paid),
    finance: {
      totalDeposit: finance.totalDeposit,
      totalBookingFee: finance.totalBookingFee,
      totalPaidOnline: finance.totalPaidOnline,
      payableOnSite: finance.payableOnSite,
      grossRefund: finance.grossRefund,
      totalPenalties: finance.totalPenalties,
      netRefund: finance.netRefund,
      debt: finance.debt,
      penaltyDetails: finance.penaltyDetails,
    },
  };
}

/** Maximum tip we accept (sanity cap, toman). */
const MAX_TIP = 50_000_000;

/**
 * Record a tip for a completed reservation. Money is NOT actually moved — it
 * goes through the (stub) payment seam and is stored with the returned status
 * (currently 'recorded'). One tip per reservation (idempotent).
 */
export async function recordTip(customerId: string, reservationId: string, amount: number) {
  if (!Types.ObjectId.isValid(reservationId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  if (!(amount > 0)) throw AppError.badRequest('مبلغ انعام نامعتبر است', 'INVALID_AMOUNT');
  if (amount > MAX_TIP) throw AppError.badRequest('مبلغ انعام بیش از حد مجاز است', 'TIP_TOO_LARGE');

  const reservation = await Reservation.findById(reservationId).lean();
  if (!reservation) throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');
  if (String(reservation.customerId) !== customerId) {
    throw AppError.forbidden('دسترسی غیرمجاز', 'FORBIDDEN');
  }
  if (reservation.status !== 'completed') {
    throw AppError.badRequest('انعام فقط برای نوبت انجام‌شده ممکن است', 'NOT_COMPLETED');
  }

  const already = await Tip.findOne({ reservationId }).lean();
  if (already) throw AppError.conflict('برای این نوبت قبلاً انعام ثبت شده است', 'TIP_ALREADY_RECORDED');

  // Payment seam (stub) — see utils/payment.ts. No real charge happens yet.
  const charge = await paymentProvider.recordTip({
    customerId,
    stylistId: String(reservation.stylistId),
    amount,
  });

  try {
    const tip = await Tip.create({
      reservationId: reservation._id,
      customerId: new Types.ObjectId(customerId),
      stylistId: reservation.stylistId,
      amount,
      status: charge.status,
    });
    return { id: String(tip._id), amount: tip.amount, status: tip.status };
  } catch {
    // Unique-index race: another request recorded it first.
    throw AppError.conflict('برای این نوبت قبلاً انعام ثبت شده است', 'TIP_ALREADY_RECORDED');
  }
}

/** A stylist's received tips: total + per-reservation list. */
export async function getStylistTips(stylistId: string) {
  const tips = await Tip.find({ stylistId: new Types.ObjectId(stylistId) })
    .sort({ createdAt: -1 })
    .lean();
  const total = tips.reduce((s, t) => s + t.amount, 0);

  const reservationIds = tips.map((t) => t.reservationId);
  const reservations = await Reservation.find({ _id: { $in: reservationIds } })
    .select('date customerId')
    .lean();
  const resById = new Map(reservations.map((r) => [String(r._id), r]));
  const customerIds = reservations.map((r) => r.customerId);
  const customers = await User.find({ _id: { $in: customerIds } })
    .select('firstName lastName')
    .lean();
  const custById = new Map(customers.map((u) => [String(u._id), u]));

  return {
    total,
    count: tips.length,
    items: tips.map((t) => {
      const r = resById.get(String(t.reservationId));
      const cust = r ? custById.get(String(r.customerId)) : null;
      return {
        id: String(t._id),
        amount: t.amount,
        status: t.status,
        date: r ? r.date.toISOString().slice(0, 10) : null,
        customerName: cust
          ? `${cust.firstName ?? ''} ${cust.lastName ?? ''}`.trim() || 'مشتری'
          : 'مشتری',
        createdAt: t.createdAt,
      };
    }),
  };
}

/**
 * Quick-rebook suggestions: (stylist, service) pairs the customer has completed
 * at least `quickRebookThreshold` times, that are STILL bookable (stylist active
 * + service still offered). Returns enough data to pre-fill the booking flow.
 *
 * Counting is per-item (a multi-service booking counts each service), via
 * $unwind on items (with a fallback to the single serviceId for legacy rows).
 * `lastUsedDate` is the Iran calendar day (date is stored at its UTC midnight).
 */
export async function getQuickRebookSuggestions(customerId: string) {
  const rows: { _id: { stylistId: Types.ObjectId; serviceId: Types.ObjectId }; timesUsed: number; lastUsedDate: Date }[] =
    await Reservation.aggregate([
      { $match: { customerId: new Types.ObjectId(customerId), status: 'completed' } },
      {
        $addFields: {
          _items: {
            $cond: [
              { $gt: [{ $size: { $ifNull: ['$items', []] } }, 0] },
              '$items',
              [{ serviceId: '$serviceId' }],
            ],
          },
        },
      },
      { $unwind: '$_items' },
      {
        $group: {
          _id: { stylistId: '$stylistId', serviceId: '$_items.serviceId' },
          timesUsed: { $sum: 1 },
          lastUsedDate: { $max: '$date' },
        },
      },
      { $match: { timesUsed: { $gte: config.quickRebookThreshold } } },
      { $sort: { timesUsed: -1, lastUsedDate: -1 } },
    ]);

  if (rows.length === 0) return { suggestions: [] };

  const stylistIds = [...new Set(rows.map((r) => String(r._id.stylistId)))];
  const serviceIds = [...new Set(rows.map((r) => String(r._id.serviceId)))];

  // Only ACTIVE stylists; only services STILL offered by that stylist.
  const [profiles, users, services, links] = await Promise.all([
    StylistProfile.find({ userId: { $in: stylistIds }, status: 'active' }).select('userId username').lean(),
    User.find({ _id: { $in: stylistIds } })
      .select('firstName lastName isForeignNational foreignApprovalStatus')
      .lean(),
    Service.find({ _id: { $in: serviceIds } }).lean(),
    StylistService.find({
      stylistId: { $in: stylistIds },
      serviceId: { $in: serviceIds },
    }).lean(),
  ]);

  const activeStylist = new Set(profiles.map((p) => String(p.userId)));
  const usernameBy = new Map(profiles.filter((p) => p.username).map((p) => [String(p.userId), p.username!]));
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const svcById = new Map(services.map((s) => [String(s._id), s as unknown as IService]));
  const linkByKey = new Map(
    links.map((l) => [`${String(l.stylistId)}:${String(l.serviceId)}`, l]),
  );

  const suggestions = rows
    .map((r) => {
      const stylistId = String(r._id.stylistId);
      const serviceId = String(r._id.serviceId);
      if (!activeStylist.has(stylistId)) return null; // stylist no longer active
      // A foreign stylist awaiting/denied approval can't take bookings — don't
      // suggest them only for the booking to fail.
      if (isForeignRestricted(userById.get(stylistId))) return null;
      const link = linkByKey.get(`${stylistId}:${serviceId}`);
      const svc = svcById.get(serviceId);
      if (!link || !svc) return null; // service no longer offered
      const user = userById.get(stylistId);
      return {
        stylistId,
        stylistUsername: usernameBy.get(stylistId) ?? null,
        stylistName:
          `${user?.firstName ?? ''} ${user?.lastName ?? ''}`.trim() || 'متخصص',
        serviceId,
        serviceName: svc.name,
        timesUsed: r.timesUsed,
        lastUsedDate: r.lastUsedDate ? new Date(r.lastUsedDate).toISOString().slice(0, 10) : null,
        price: effectivePrice(link.price, svc),
        durationMin: effectiveDuration(link.durationMin, svc),
      };
    })
    .filter(Boolean);

  return { suggestions };
}

/** Build the public reservation DTO, enriching with service/stylist/salon info. */
async function serializeReservation(
  r: IReservation,
  viewer: 'customer' | 'stylist' = 'customer',
  extra: { outOfHours?: boolean } = {},
) {
  const ids = r.serviceIds?.length ? r.serviceIds : [r.serviceId];
  const [services, stylist, customer, salon, tip] = await Promise.all([
    Service.find({ _id: { $in: ids } }).select('name durationMin').lean(),
    User.findById(r.stylistId).select('firstName lastName profilePhoto phone').lean(),
    viewer === 'stylist'
      ? User.findById(r.customerId).select('firstName lastName phone').lean()
      : Promise.resolve(null),
    r.salonId ? Salon.findById(r.salonId).select('name address').lean() : Promise.resolve(null),
    Tip.findOne({ reservationId: r._id }).select('amount status').lean(),
  ]);

  const photo = (stylist as { profilePhoto?: string } | null)?.profilePhoto;

  return {
    id: String(r._id),
    status: r.status,
    date: r.date.toISOString().slice(0, 10),
    startTime: r.startTime,
    endTime: r.endTime,
    startAt: r.startAt,
    endAt: r.endAt,
    price: r.price ?? null,
    discount: r.discountCode
      ? {
          code: r.discountCode,
          type: r.discountType ?? null,
          value: r.discountValue ?? null,
          amount: r.discountAmount ?? 0,
          originalPrice: r.originalPrice ?? r.price ?? null,
          finalPrice: r.finalPrice ?? r.price ?? null,
        }
      : null,
    services: services.map((s) => ({ id: String(s._id), name: s.name, durationMin: s.durationMin })),
    stylist: stylist
      ? {
          id: String(r.stylistId),
          fullName:
            `${stylist.firstName ?? ''} ${stylist.lastName ?? ''}`.trim() || 'متخصص',
          profilePhoto: photo ? storageProvider.getUrl(photo) : null,
          phone: (stylist as { phone?: string }).phone ?? null,
        }
      : null,
    customer:
      viewer === 'stylist' && customer
        ? {
            id: String(r.customerId),
            fullName: `${customer.firstName ?? ''} ${customer.lastName ?? ''}`.trim() || 'مشتری',
            phone: (customer as { phone?: string }).phone ?? null,
          }
        : null,
    salon: salon ? { id: String(r.salonId), name: salon.name, address: salon.address ?? null } : null,
    customerNote: r.customerNote ?? null,
    companionsCount: r.companionsCount ?? 0,
    totalPersons: (r.companionsCount ?? 0) + 1,
    totalDuration: Math.max(0, toMinutes(r.endTime) - toMinutes(r.startTime)),
    cancelledBy: r.cancelledBy ?? null,
    cancelReason: r.cancelReason ?? null,
    // Policy outcome captured at cancel time (display/record only; not settled).
    deposit: r.deposit ?? null,
    cancellationOutcome: r.cancellationOutcome ?? null,
    rescheduleHistory: (r.rescheduleHistory ?? []).map((h) => ({
      fromDate: h.fromDate,
      fromStartTime: h.fromStartTime,
      toDate: h.toDate,
      toStartTime: h.toStartTime,
      by: h.by,
      at: h.at,
      free: h.free ?? true,
      penaltyAmount: h.penaltyAmount ?? null,
    })),
    // Financial adjustments (single source of truth).
    financialAdjustments: (r.financialAdjustments ?? []).map((a) => ({
      type: a.type,
      label: a.label,
      amount: a.amount,
      direction: a.direction,
      status: a.status,
      reason: a.reason,
      createdAt: a.createdAt,
    })),
    rescheduleCount: r.rescheduleCount ?? 0,
    maxReschedules: r.maxReschedules ?? 2,
    tip: tip ? { amount: tip.amount, status: tip.status } : null,
    /**
     * For the stylist view: this future reservation no longer falls inside the
     * stylist's current (post-change) working hours. It is NOT cancelled — the
     * panel marks it so the stylist can reschedule / fix their hours.
     */
    outOfHours: extra.outOfHours ?? false,
    canCancel:
      ['pending', 'confirmed'].includes(r.status) &&
      r.startAt.getTime() - Date.now() >= CANCEL_WINDOW_MS,
    /** A stylist may cancel a future confirmed reservation. */
    canCancelAsStylist: r.status === 'confirmed' && r.startAt.getTime() > Date.now(),
    /** Customer or stylist may reschedule a confirmed, future reservation. */
    canReschedule: r.status === 'confirmed' && r.startAt.getTime() > Date.now(),
    /** The customer may tip a completed reservation that has no tip yet. */
    canTip: r.status === 'completed' && !tip,
  };
}
