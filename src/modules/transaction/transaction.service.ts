import { PaymentTransaction } from '../../models/PaymentTransaction';
import { Reservation } from '../../models/Reservation';
import { Service } from '../../models/Service';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';

export interface TransactionListQuery {
  status?: string;
  purpose?: string;
  page?: number;
  limit?: number;
}

export interface EnrichedTransaction {
  id: string;
  provider: string;
  purpose: string;
  amountToman: number;
  orderId: string;
  trackId: string | null;
  status: string;
  resultCode: number | null;
  message: string | null;
  refNumber: string | null;
  cardNumber: string | null;
  paidAt: string | null;
  createdAt: string;
  reservation?: {
    id: string;
    stylistId: string;
    stylistName: string;
    serviceNames: string[];
    date: string;
    startTime: string;
    endTime: string;
    status: string;
    paymentStatus: string;
    finalPrice: number;
    originalPrice: number | null;
    discountAmount: number | null;
  } | null;
  planTier?: string | null;
  payerName?: string | null;
}

function enrichTransactionFromMaps(
  tx: Record<string, any>,
  maps: {
    reservationById: Map<string, any>;
    userById: Map<string, { firstName?: string; lastName?: string; phone?: string }>;
  },
): EnrichedTransaction {
  const e: EnrichedTransaction = {
    id: String(tx._id),
    provider: tx.provider,
    purpose: tx.purpose,
    amountToman: tx.amountToman,
    orderId: tx.orderId,
    trackId: tx.trackId ?? null,
    status: tx.status,
    resultCode: tx.resultCode ?? null,
    message: tx.message ?? null,
    refNumber: tx.refNumber ?? null,
    cardNumber: tx.cardNumber ?? null,
    paidAt: tx.paidAt ? tx.paidAt.toISOString() : null,
    createdAt: tx.createdAt?.toISOString() ?? new Date().toISOString(),
  };

  const meta = (tx.meta ?? {}) as Record<string, unknown>;

  if (tx.purpose === 'reservation_deposit') {
    const reservationId = meta.reservationId;
    if (typeof reservationId === 'string') {
      const reservation = maps.reservationById.get(reservationId);
      if (reservation) {
        const stylistUser = maps.userById.get(String(reservation.stylistId));
        const stylistName = stylistUser
          ? `${stylistUser.firstName ?? ''} ${stylistUser.lastName ?? ''}`.trim()
          : '';

        const customerUser = maps.userById.get(String(reservation.customerId));
        const payerName = customerUser
          ? `${customerUser.firstName ?? ''} ${customerUser.lastName ?? ''}`.trim() || customerUser.phone
          : null;

        let serviceNames: string[] = [];
        if (reservation.serviceIds && Array.isArray(reservation.serviceIds)) {
          serviceNames = reservation.serviceIds
            .map((s: any) => (typeof s === 'object' && s?.name ? s.name : ''))
            .filter(Boolean);
        }

        e.reservation = {
          id: String(reservation._id),
          stylistId: String(reservation.stylistId),
          stylistName,
          serviceNames,
          date: reservation.date
            ? new Date(reservation.date).toISOString().slice(0, 10)
            : '',
          startTime: reservation.startTime ?? '',
          endTime: reservation.endTime ?? '',
          status: reservation.status,
          paymentStatus: reservation.paymentStatus,
          finalPrice: reservation.finalPrice ?? reservation.price ?? 0,
          originalPrice: reservation.originalPrice ?? null,
          discountAmount: reservation.discountAmount ?? null,
        };
        e.payerName = payerName;
      }
    }
  }

  if (tx.purpose === 'plan_purchase') {
    e.planTier = typeof meta.planTier === 'string' ? meta.planTier : null;
  }

  return e;
}

async function batchEnrichTransactions(
  txs: Record<string, any>[],
): Promise<EnrichedTransaction[]> {
  if (txs.length === 0) return [];

  // Collect reservation IDs from reservation_deposit transactions.
  const reservationIds = new Set<string>();
  for (const tx of txs) {
    if (tx.purpose === 'reservation_deposit') {
      const rid = (tx.meta ?? {})?.reservationId;
      if (typeof rid === 'string') reservationIds.add(rid);
    }
  }

  // Batch-load reservations + services + users.
  const [reservations, allServices] = await Promise.all([
    reservationIds.size > 0
      ? Reservation.find({ _id: { $in: [...reservationIds] } })
          .select('stylistId customerId serviceIds startTime endTime date status paymentStatus finalPrice price originalPrice discountAmount')
          .lean()
      : Promise.resolve([]),
    Service.find().select('name').lean(),
  ]);

  const serviceById = new Map(allServices.map((s) => [String(s._id), s]));

  // Populate serviceIds with names.
  for (const r of reservations) {
    if (r.serviceIds && Array.isArray(r.serviceIds)) {
      r.serviceIds = r.serviceIds.map((id: any) => {
        const svc = serviceById.get(String(id));
        return svc ? { _id: svc._id, name: svc.name } : id;
      });
    }
  }

  const reservationById = new Map(reservations.map((r) => [String(r._id), r]));

  // Collect user IDs from reservations.
  const userIds = new Set<string>();
  for (const r of reservations) {
    userIds.add(String(r.stylistId));
    userIds.add(String(r.customerId));
  }

  const users = userIds.size > 0
    ? await User.find({ _id: { $in: [...userIds] } }).select('firstName lastName phone').lean()
    : [];
  const userById = new Map(users.map((u) => [String(u._id), u]));

  const maps = { reservationById, userById };
  return txs.map((tx) => enrichTransactionFromMaps(tx, maps));
}

async function enrichTransaction(
  tx: Record<string, any>,
): Promise<EnrichedTransaction> {
  return batchEnrichTransactions([tx]).then((r) => r[0]);
}

export async function listMyTransactions(
  userId: string,
  query: TransactionListQuery,
): Promise<{ items: EnrichedTransaction[]; total: number; page: number; totalPages: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const filter: Record<string, any> = { userId };

  if (query.status) filter.status = query.status;
  if (query.purpose) filter.purpose = query.purpose;

  const [raw, total] = await Promise.all([
    PaymentTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PaymentTransaction.countDocuments(filter),
  ]);

  const items = await batchEnrichTransactions(raw);
  return { items, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getMyTransaction(
  userId: string,
  txId: string,
): Promise<EnrichedTransaction> {
  const tx = await PaymentTransaction.findOne({ _id: txId, userId }).lean();
  if (!tx) throw AppError.notFound('تراکنش یافت نشد');
  return batchEnrichTransactions([tx]).then((r) => r[0]);
}

export async function listStylistTransactions(
  stylistUserId: string,
  query: TransactionListQuery,
): Promise<{ items: EnrichedTransaction[]; total: number; page: number; totalPages: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));

  const reservations = await Reservation.find({ stylistId: stylistUserId, paymentTxId: { $ne: null } })
    .select('paymentTxId')
    .lean();
  const reserveTxIds = reservations.map((r) => r.paymentTxId).filter(Boolean);

  const filter: Record<string, any> = {
    $or: [
      { _id: { $in: reserveTxIds } },
      { userId: stylistUserId, purpose: { $in: ['plan_purchase', 'wallet_topup'] } },
    ],
  };
  if (query.status) filter.status = query.status;
  if (query.purpose) filter.purpose = query.purpose;

  const [raw, total] = await Promise.all([
    PaymentTransaction.find(filter)
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    PaymentTransaction.countDocuments(filter),
  ]);

  const items = await batchEnrichTransactions(raw);
  return { items, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getStylistTransaction(
  stylistUserId: string,
  txId: string,
): Promise<EnrichedTransaction> {
  const reservations = await Reservation.find({ stylistId: stylistUserId, paymentTxId: { $ne: null } })
    .select('paymentTxId')
    .lean();
  const reserveTxIds = reservations.map((r) => r.paymentTxId).filter(Boolean);

  const tx = await PaymentTransaction.findOne({
    _id: txId,
    $or: [
      { _id: { $in: reserveTxIds } },
      { userId: stylistUserId },
    ],
  }).lean();
  if (!tx) throw AppError.notFound('تراکنش یافت نشد');
  return batchEnrichTransactions([tx]).then((r) => r[0]);
}

export async function getStylistTransactionStats(
  stylistUserId: string,
): Promise<{
  totalCount: number;
  totalAmount: number;
  paidCount: number;
  paidAmount: number;
  failedCount: number;
  pendingCount: number;
}> {
  const reservations = await Reservation.find({ stylistId: stylistUserId, paymentTxId: { $ne: null } })
    .select('paymentTxId')
    .lean();
  const reserveTxIds = reservations.map((r) => r.paymentTxId).filter(Boolean);

  const matchFilter = {
    $or: [
      { _id: { $in: reserveTxIds } },
      { userId: stylistUserId, purpose: { $in: ['plan_purchase', 'wallet_topup'] } },
    ],
  };

  const pipeline = await PaymentTransaction.aggregate([
    { $match: matchFilter },
    {
      $group: {
        _id: null,
        totalCount: { $sum: 1 },
        totalAmount: { $sum: '$amountToman' },
        paidCount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, 1, 0] } },
        paidAmount: { $sum: { $cond: [{ $eq: ['$status', 'paid'] }, '$amountToman', 0] } },
        failedCount: { $sum: { $cond: [{ $eq: ['$status', 'failed'] }, 1, 0] } },
        pendingCount: { $sum: { $cond: [{ $in: ['$status', ['pending', 'initiated']] }, 1, 0] } },
      },
    },
  ]);

  const row = pipeline[0];
  return {
    totalCount: row?.totalCount ?? 0,
    totalAmount: row?.totalAmount ?? 0,
    paidCount: row?.paidCount ?? 0,
    paidAmount: row?.paidAmount ?? 0,
    failedCount: row?.failedCount ?? 0,
    pendingCount: row?.pendingCount ?? 0,
  };
}
