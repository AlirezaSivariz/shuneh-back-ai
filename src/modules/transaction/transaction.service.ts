import { PaymentTransaction } from '../../models/PaymentTransaction';
import { Reservation } from '../../models/Reservation';
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

async function enrichTransaction(
  tx: Record<string, any>,
): Promise<EnrichedTransaction> {
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
      const reservation = await Reservation.findById(reservationId)
        .populate('serviceIds')
        .lean();
      if (reservation) {
        const stylistUser = await User.findById(reservation.stylistId).select('firstName lastName phone').lean();
        const stylistName =
          stylistUser
            ? `${stylistUser.firstName ?? ''} ${stylistUser.lastName ?? ''}`.trim()
            : '';

        const customerUser = await User.findById(reservation.customerId).select('firstName lastName phone').lean();
        const payerName =
          customerUser
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

  const items = await Promise.all(raw.map(enrichTransaction));
  return { items, total, page, totalPages: Math.ceil(total / limit) };
}

export async function getMyTransaction(
  userId: string,
  txId: string,
): Promise<EnrichedTransaction> {
  const tx = await PaymentTransaction.findOne({ _id: txId, userId }).lean();
  if (!tx) throw AppError.notFound('تراکنش یافت نشد');
  return enrichTransaction(tx);
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

  const items = await Promise.all(raw.map(enrichTransaction));
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
  return enrichTransaction(tx);
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

  const filter = {
    $or: [
      { _id: { $in: reserveTxIds } },
      { userId: stylistUserId, purpose: { $in: ['plan_purchase', 'wallet_topup'] } },
    ],
  };

  const all = await PaymentTransaction.find(filter).select('status amountToman').lean();

  const totalCount = all.length;
  const totalAmount = all.reduce((s, t) => s + t.amountToman, 0);
  const paid = all.filter((t) => t.status === 'paid');
  const failed = all.filter((t) => t.status === 'failed');
  const pending = all.filter((t) => t.status === 'pending' || t.status === 'initiated');

  return {
    totalCount,
    totalAmount,
    paidCount: paid.length,
    paidAmount: paid.reduce((s, t) => s + t.amountToman, 0),
    failedCount: failed.length,
    pendingCount: pending.length,
  };
}
