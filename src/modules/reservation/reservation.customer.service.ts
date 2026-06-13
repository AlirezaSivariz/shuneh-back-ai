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
import { StylistSalon } from '../../models/StylistSalon';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { toMinutes, overlaps, contains } from '../../utils/time';
import { iranWallClockToUtc } from '../../utils/timezone';
import { storageProvider } from '../../utils/storage';
import { smsProvider } from '../../utils/sms';
import { effectivePrice, effectiveDuration } from '../stylist/public.service';
import { resolveDiscountForBooking, consumeDiscount } from '../discount/discount.service';

const CANCEL_WINDOW_MS = 2 * 60 * 60 * 1000; // 2 hours

interface CreateInput {
  stylistId: string;
  salonId?: string | null;
  serviceIds: string[];
  date: string; // YYYY-MM-DD
  startTime: string; // HH:mm
  discountCode?: string;
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

  const profile = await StylistProfile.findOne({ userId: stylistId }).lean();
  if (!profile || profile.status !== 'active') {
    throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
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

  // A pending salon is bookable, but a rejected membership is not.
  if (salonId) {
    const membership = await StylistSalon.findOne({ stylistId, salonId }).lean();
    if (membership?.status === 'rejected') {
      throw AppError.badRequest('این سالن برای رزرو در دسترس نیست', 'SALON_REJECTED');
    }
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
    status: 'confirmed', // auto-confirm
  });

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

  return serializeReservation(reservation);
}

type Filter = 'upcoming' | 'past' | undefined;

function filterQuery(base: Record<string, unknown>, filter: Filter) {
  const now = new Date();
  if (filter === 'upcoming') {
    return { ...base, status: { $in: ['pending', 'confirmed'] }, startAt: { $gte: now } };
  }
  if (filter === 'past') {
    return {
      ...base,
      $or: [{ status: { $in: ['completed', 'cancelled', 'no_show'] } }, { startAt: { $lt: now } }],
    };
  }
  return base;
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
  return Promise.all(reservations.map((r) => serializeReservation(r, 'stylist')));
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

  reservation.status = 'cancelled';
  reservation.cancelledBy = 'customer';
  await reservation.save();
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

  reservation.status = 'cancelled';
  reservation.cancelledBy = 'stylist';
  reservation.cancelReason = reason ?? null;
  await reservation.save();

  // Notify the customer (best-effort; SMS failure must not fail the cancel).
  void (async () => {
    try {
      const customer = await User.findById(reservation.customerId).select('phone').lean();
      if (customer?.phone) {
        await smsProvider.send(
          customer.phone,
          `نوبت شما در تاریخ ${reservation.date.toISOString().slice(0, 10)} ساعت ${reservation.startTime} توسط متخصص لغو شد.${reason ? ` علت: ${reason}` : ''}`,
        );
      }
    } catch {
      /* swallow SMS errors */
    }
  })();

  return serializeReservation(reservation, 'stylist');
}

/** Build the public reservation DTO, enriching with service/stylist/salon info. */
async function serializeReservation(r: IReservation, viewer: 'customer' | 'stylist' = 'customer') {
  const ids = r.serviceIds?.length ? r.serviceIds : [r.serviceId];
  const [services, stylist, customer, salon] = await Promise.all([
    Service.find({ _id: { $in: ids } }).select('name durationMin').lean(),
    User.findById(r.stylistId).select('firstName lastName profilePhoto').lean(),
    viewer === 'stylist'
      ? User.findById(r.customerId).select('firstName lastName phone').lean()
      : Promise.resolve(null),
    r.salonId ? Salon.findById(r.salonId).select('name address').lean() : Promise.resolve(null),
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
    cancelledBy: r.cancelledBy ?? null,
    cancelReason: r.cancelReason ?? null,
    canCancel:
      ['pending', 'confirmed'].includes(r.status) &&
      r.startAt.getTime() - Date.now() >= CANCEL_WINDOW_MS,
    /** A stylist may cancel a future confirmed reservation. */
    canCancelAsStylist: r.status === 'confirmed' && r.startAt.getTime() > Date.now(),
  };
}
