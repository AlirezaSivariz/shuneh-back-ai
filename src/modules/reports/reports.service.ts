/**
 * Reporting for stylists and customers.
 *
 * All figures come from the reservation snapshots taken at booking time:
 *   - `price`  → total snapshot price of a reservation
 *   - `items[]`→ per-service price/duration snapshot (falls back to the single
 *                {serviceId, price} for legacy reservations created before the
 *                snapshot existed)
 * The date filter is on `reservation.date` (an Iran calendar day stored at its
 * UTC midnight). There is no independent "expenses" concept in the database —
 * reports are derived purely from reservation prices.
 */
import { Types } from 'mongoose';
import { Reservation, RESERVATION_STATUSES, ReservationStatus } from '../../models/Reservation';
import { Service } from '../../models/Service';
import { Salon } from '../../models/Salon';

function dayRange(from: string, to: string) {
  return {
    $gte: new Date(`${from}T00:00:00.000Z`),
    $lte: new Date(`${to}T00:00:00.000Z`),
  };
}

/** Build a {status: count} map with every status present (default 0). */
function statusMap(rows: { _id: ReservationStatus; count: number }[]): Record<ReservationStatus, number> {
  const map = Object.fromEntries(RESERVATION_STATUSES.map((s) => [s, 0])) as Record<
    ReservationStatus,
    number
  >;
  for (const r of rows) if (r._id) map[r._id] = r.count;
  return map;
}

/** Resolve service ids → names for the per-service breakdown. */
async function withServiceNames(
  rows: { _id: Types.ObjectId; count: number; revenue: number }[],
) {
  const ids = rows.map((r) => r._id).filter(Boolean);
  const services = await Service.find({ _id: { $in: ids } }).select('name').lean();
  const nameById = new Map(services.map((s) => [String(s._id), s.name]));
  return rows.map((r) => ({
    serviceId: String(r._id),
    name: nameById.get(String(r._id)) ?? '—',
    count: r.count,
    revenue: r.revenue,
  }));
}

/** Aggregation stage: explode reservations into per-service items (with fallback). */
const itemsStage = [
  {
    $addFields: {
      _items: {
        $cond: [
          { $gt: [{ $size: { $ifNull: ['$items', []] } }, 0] },
          '$items',
          [{ serviceId: '$serviceId', price: { $ifNull: ['$price', 0] } }],
        ],
      },
    },
  },
  { $unwind: '$_items' },
];

// ───────────────────────────── Stylist report ─────────────────────────────

export async function getStylistReport(stylistId: string, from: string, to: string) {
  const match = { stylistId: new Types.ObjectId(stylistId), date: dayRange(from, to) };

  const [agg] = await Reservation.aggregate([
    { $match: match },
    {
      $facet: {
        byStatus: [
          { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$price', 0] } } } },
        ],
        byService: [
          { $match: { status: 'completed' } },
          ...itemsStage,
          {
            $group: {
              _id: '$_items.serviceId',
              count: { $sum: 1 },
              revenue: { $sum: { $ifNull: ['$_items.price', 0] } },
            },
          },
          { $sort: { revenue: -1 } },
        ],
        bySalon: [
          { $match: { status: 'completed' } },
          { $group: { _id: '$salonId', count: { $sum: 1 }, revenue: { $sum: { $ifNull: ['$price', 0] } } } },
        ],
      },
    },
  ]);

  const byStatusRows: { _id: ReservationStatus; count: number; value: number }[] = agg?.byStatus ?? [];
  const byStatus = statusMap(byStatusRows);
  const totalReservations = byStatusRows.reduce((s, r) => s + r.count, 0);
  const valueOf = (st: ReservationStatus) => byStatusRows.find((r) => r._id === st)?.value ?? 0;

  const grossIncome = valueOf('completed');
  const cancelledValue = valueOf('cancelled');
  const commission = 0; // placeholder — future commission model
  const netIncome = grossIncome - commission;

  const byService = await withServiceNames(agg?.byService ?? []);

  const salonRows: { _id: Types.ObjectId | null; count: number; revenue: number }[] = agg?.bySalon ?? [];
  const salonIds = salonRows.map((r) => r._id).filter(Boolean) as Types.ObjectId[];
  const salons = await Salon.find({ _id: { $in: salonIds } }).select('name').lean();
  const salonName = new Map(salons.map((s) => [String(s._id), s.name]));
  const bySalon = salonRows.map((r) => ({
    salonId: r._id ? String(r._id) : null,
    name: r._id ? salonName.get(String(r._id)) ?? '—' : 'فریلنس / بدون سالن',
    count: r.count,
    revenue: r.revenue,
  }));

  return {
    range: { from, to },
    totals: {
      reservations: totalReservations,
      grossIncome,
      cancelledValue,
      commission,
      netIncome,
    },
    byStatus,
    byService,
    bySalon,
  };
}

// ─────────────────────────── Stylist analytics ───────────────────────────

/**
 * Analytics for a stylist: most-booked services (ranked by booking count, with
 * revenue and share-of-total) and a weekday breakdown (which days are busiest).
 *
 * Computed over COMPLETED reservations in the range (realized business), so the
 * counts/revenue stay consistent. The date filter is on `reservation.date`; the
 * weekday is derived in Iran time — because `date` stores the Iran calendar day
 * in its UTC components, `$dayOfWeek` with timezone 'UTC' yields the Iran
 * weekday (Mongo 1=Sun…7=Sat → JS 0=Sun…6=Sat via `- 1`).
 *
 * Service ranking is per-ITEM (a multi-service booking counts once per service,
 * via $unwind on items), as requested.
 */
export async function getStylistAnalytics(stylistId: string, from: string, to: string) {
  const match = {
    stylistId: new Types.ObjectId(stylistId),
    date: dayRange(from, to),
    status: 'completed' as ReservationStatus,
  };

  const [agg] = await Reservation.aggregate([
    { $match: match },
    {
      $facet: {
        byService: [
          ...itemsStage,
          {
            $group: {
              _id: '$_items.serviceId',
              count: { $sum: 1 },
              revenue: { $sum: { $ifNull: ['$_items.price', 0] } },
            },
          },
          { $sort: { count: -1, revenue: -1 } },
        ],
        byDayOfWeek: [
          {
            $group: {
              _id: { $subtract: [{ $dayOfWeek: { date: '$date', timezone: 'UTC' } }, 1] },
              count: { $sum: 1 },
              revenue: { $sum: { $ifNull: ['$price', 0] } },
            },
          },
        ],
        reservationCount: [{ $count: 'n' }],
      },
    },
  ]);

  const serviceRows: { _id: Types.ObjectId; count: number; revenue: number }[] = agg?.byService ?? [];
  const totalServiceCount = serviceRows.reduce((s, r) => s + r.count, 0);
  const named = await withServiceNames(serviceRows);
  const byService = named.map((r) => ({
    serviceId: r.serviceId,
    serviceName: r.name,
    count: r.count,
    revenue: r.revenue,
    // One decimal place; shares sum to ~100%.
    sharePercent: totalServiceCount > 0 ? Math.round((r.count / totalServiceCount) * 1000) / 10 : 0,
  }));

  const dayRows: { _id: number; count: number; revenue: number }[] = agg?.byDayOfWeek ?? [];
  const dayMap = new Map(dayRows.map((r) => [r._id, r]));
  const byDayOfWeek = Array.from({ length: 7 }, (_, dayOfWeek) => {
    const row = dayMap.get(dayOfWeek);
    return { dayOfWeek, count: row?.count ?? 0, revenue: row?.revenue ?? 0 };
  });

  const reservations: number = agg?.reservationCount?.[0]?.n ?? 0;

  return {
    range: { from, to },
    totals: { reservations, services: totalServiceCount },
    byService,
    byDayOfWeek,
  };
}

// ───────────────────────────── Customer report ─────────────────────────────

export async function getCustomerReport(customerId: string, from: string, to: string) {
  const match = { customerId: new Types.ObjectId(customerId), date: dayRange(from, to) };

  const [agg] = await Reservation.aggregate([
    { $match: match },
    {
      $facet: {
        byStatus: [
          { $group: { _id: '$status', count: { $sum: 1 }, value: { $sum: { $ifNull: ['$price', 0] } } } },
        ],
        byService: [
          { $match: { status: 'completed' } },
          ...itemsStage,
          {
            $group: {
              _id: '$_items.serviceId',
              count: { $sum: 1 },
              revenue: { $sum: { $ifNull: ['$_items.price', 0] } },
            },
          },
          { $sort: { revenue: -1 } },
        ],
      },
    },
  ]);

  const byStatusRows: { _id: ReservationStatus; count: number; value: number }[] = agg?.byStatus ?? [];
  const byStatus = statusMap(byStatusRows);
  const totalReservations = byStatusRows.reduce((s, r) => s + r.count, 0);
  const totalSpent = byStatusRows.find((r) => r._id === 'completed')?.value ?? 0;

  // Upcoming is a present-time snapshot (active future reservations), not bound
  // by the report's date range.
  const upcoming = await Reservation.countDocuments({
    customerId: new Types.ObjectId(customerId),
    status: { $in: ['pending', 'confirmed'] },
    startAt: { $gte: new Date() },
  });

  const byService = (await withServiceNames(agg?.byService ?? [])).map((s) => ({
    serviceId: s.serviceId,
    name: s.name,
    count: s.count,
    spent: s.revenue,
  }));

  return {
    range: { from, to },
    totals: {
      reservations: totalReservations,
      totalSpent,
      upcoming,
    },
    byStatus,
    byService,
  };
}
