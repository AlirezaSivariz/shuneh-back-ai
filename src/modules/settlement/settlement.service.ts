import { Types } from 'mongoose';
import { StylistSettlement, IStylistSettlement, SettlementStatus } from '../../models/StylistSettlement';
import { Reservation } from '../../models/Reservation';
import { User } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { notificationService } from '../../utils/notification';

/**
 * Get the stylist's current settlement balance: total confirmed deposits
 * that are not yet settled, minus pending settlement requests.
 */
export async function getSettlementBalance(stylistId: string) {
  // All paid deposits on confirmed/completed reservations where no
  // cancellation refund was issued (cancellationOutcome.settled !== true).
  const reservations = await Reservation.find({
    stylistId: new Types.ObjectId(stylistId),
    paymentStatus: 'paid',
    status: { $in: ['confirmed', 'completed'] },
  })
    .select('deposit')
    .lean();

  const totalDeposits = reservations.reduce(
    (sum, r) => sum + ((r.deposit?.amount ?? 0) - (r.deposit?.bookingFee ?? 0)),
    0,
  );

  // Pending/approved (not yet paid/rejected) settlement amounts.
  const pendingSettlements = await StylistSettlement.find({
    stylistId: new Types.ObjectId(stylistId),
    status: { $in: ['pending', 'approved'] },
  })
    .select('amount')
    .lean();

  const pendingAmount = pendingSettlements.reduce((sum, s) => sum + s.amount, 0);
  const availableBalance = Math.max(0, totalDeposits - pendingAmount);

  return {
    totalDeposits,
    pendingAmount,
    availableBalance,
    pendingCount: pendingSettlements.length,
  };
}

export interface CreateSettlementInput {
  amount: number;
}

/**
 * Create a settlement request. The stylist can only request up to their
 * available balance.
 */
export async function createSettlementRequest(
  stylistId: string,
  input: CreateSettlementInput,
) {
  const amount = Math.trunc(input.amount);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw AppError.badRequest('مبلغ نامعتبر است', 'INVALID_AMOUNT');
  }

  const balance = await getSettlementBalance(stylistId);
  if (amount > balance.availableBalance) {
    throw AppError.badRequest(
      'موجودی قابل برداشت کافی نیست',
      'INSUFFICIENT_BALANCE',
    );
  }

  // Reservations whose deposits (minus fee) are being settled.
  const reservations = await Reservation.find({
    stylistId: new Types.ObjectId(stylistId),
    paymentStatus: 'paid',
    status: { $in: ['confirmed', 'completed'] },
    _id: { $nin: await getSettledReservationIds(stylistId) },
  })
    .select('_id deposit')
    .lean();

  const settlement = await StylistSettlement.create({
    stylistId: new Types.ObjectId(stylistId),
    amount,
    depositReservationIds: reservations.map((r) => r._id),
    status: 'pending',
  });

  // Notify admins about new settlement request.
  void notifyAdminsNewSettlement(stylistId, amount);

  return serializeSettlement(settlement);
}

async function getSettledReservationIds(stylistId: string): Promise<Types.ObjectId[]> {
  const settled = await StylistSettlement.find({
    stylistId: new Types.ObjectId(stylistId),
    status: { $in: ['approved', 'paid'] },
  })
    .select('depositReservationIds')
    .lean();
  const ids: Types.ObjectId[] = [];
  for (const s of settled) {
    ids.push(...s.depositReservationIds);
  }
  return ids;
}

/**
 * List the stylist's own settlement requests.
 */
export async function listStylistSettlements(stylistId: string) {
  const items = await StylistSettlement.find({
    stylistId: new Types.ObjectId(stylistId),
  })
    .sort({ createdAt: -1 })
    .lean();
  return items.map(serializeSettlement);
}

/**
 * Admin: list all settlement requests.
 */
export async function adminListSettlements(status?: SettlementStatus) {
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;

  const items = await StylistSettlement.find(filter)
    .sort({ createdAt: -1 })
    .populate('stylistId', 'firstName lastName phone')
    .lean();

  return items.map((s) => ({
    ...serializeSettlement(s),
    stylist: s.stylistId
      ? {
          id: String(s.stylistId._id),
          fullName:
            `${(s.stylistId as unknown as { firstName?: string }).firstName ?? ''} ${(s.stylistId as unknown as { lastName?: string }).lastName ?? ''}`.trim() ||
            'متخصص',
          phone: (s.stylistId as unknown as { phone?: string }).phone ?? null,
        }
      : null,
  }));
}

/**
 * Admin: update settlement status.
 */
export async function adminUpdateSettlement(
  settlementId: string,
  adminId: string,
  input: { status: SettlementStatus; adminNote?: string },
) {
  if (!Types.ObjectId.isValid(settlementId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }

  const settlement = await StylistSettlement.findById(settlementId);
  if (!settlement) {
    throw AppError.notFound('درخواست تسویه یافت نشد', 'SETTLEMENT_NOT_FOUND');
  }

  if (settlement.status === 'paid' || settlement.status === 'rejected') {
    throw AppError.badRequest(
      'این درخواست قبلاً پردازش شده است',
      'SETTLEMENT_ALREADY_PROCESSED',
    );
  }

  settlement.status = input.status;
  settlement.processedBy = new Types.ObjectId(adminId);
  settlement.processedAt = new Date();
  if (input.adminNote) settlement.adminNote = input.adminNote;
  if (input.status === 'paid') settlement.paidAt = new Date();

  await settlement.save();

  // Notify the stylist about the status change.
  void notifyStylistSettlementStatus(
    String(settlement.stylistId),
    settlement.amount,
    input.status,
    input.adminNote,
  );

  return serializeSettlement(settlement);
}

function serializeSettlement(s: Record<string, any>) {
  return {
    id: String(s._id),
    stylistId: String(s.stylistId?._id ?? s.stylistId),
    amount: s.amount,
    depositReservationIds: (s.depositReservationIds ?? []).map(String),
    status: s.status,
    adminNote: s.adminNote ?? null,
    processedBy: s.processedBy ? String(s.processedBy) : null,
    processedAt: s.processedAt ? (s.processedAt instanceof Date ? s.processedAt.toISOString() : s.processedAt) : null,
    paidAt: s.paidAt ? (s.paidAt instanceof Date ? s.paidAt.toISOString() : s.paidAt) : null,
    createdAt: s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    updatedAt: s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
  };
}

async function notifyAdminsNewSettlement(stylistId: string, amount: number) {
  try {
    const admins = await User.find({ roles: 'admin' }).select('phone').lean();
    for (const admin of admins) {
      if (admin.phone) {
        void notificationService.adminNewSettlementRequest(admin.phone, { stylistId, amount });
      }
    }
  } catch {
    // best-effort
  }
}

async function notifyStylistSettlementStatus(
  stylistId: string,
  amount: number,
  status: SettlementStatus,
  adminNote?: string,
) {
  try {
    const stylist = await User.findById(stylistId).select('phone').lean();
    if (stylist?.phone) {
      void notificationService.settlementStatusChanged(stylist.phone, {
        amount,
        status,
        adminNote: adminNote ?? undefined,
      });
    }
  } catch {
    // best-effort
  }
}
