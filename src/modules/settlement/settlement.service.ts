import { Types } from "mongoose";
import {
  StylistSettlement,
  IStylistSettlement,
  SettlementStatus,
} from "../../models/StylistSettlement";
import { Reservation } from "../../models/Reservation";
import { User } from "../../models/User";
import { AppError } from "../../utils/AppError";
import { notificationService } from "../../utils/notification";
import { computeFinance } from "../finance/finance.service";

/**
 * A reservation is settleable only AFTER money-wise closure:
 *  - `completed` → service performed; stylist earns the deposit share.
 *  - `cancelled` → ONLY when the cancellation policy outcome was applied at
 *    cancel time (refund and/or penalty_cancellation adjustments recorded),
 *    and it still leaves a positive payout (deposit kept minus policy refund).
 * Freshly-created (`pending`/`confirmed`) or unpaid reservations are never
 * settleable — enforced here so direct API calls cannot bypass it.
 */
const SETTLABLE_PAYMENT_STATUSES = ["paid", "not_required"];

/** True when cancellation finance (policy refund/penalty) exists on the reservation. */
function hasCancellationFinance(adjustments: unknown[]): boolean {
  return (adjustments ?? []).some(
    (a: any) =>
      (a.type === "refund" && a.direction === "credit" && a.amount > 0) ||
      (a.type === "penalty_cancellation" &&
        a.direction === "debit" &&
        a.amount > 0),
  );
}

/** Stylist payout of a policy-cancelled reservation: deposit kept after refund. */
function cancelledStylistPayout(finance: {
  totalDeposit: number;
  grossRefund: number;
}): number {
  return Math.max(0, finance.totalDeposit - finance.grossRefund);
}

/** Finance snapshot for a reservation (legacy rows fall back to deposit data). */
function financeOf(r: Record<string, any>) {
  const price = r.finalPrice ?? r.price ?? 0;
  if (!r.financialAdjustments || r.financialAdjustments.length === 0) {
    const depositAmount = r.deposit?.amount ?? 0;
    const bookingFee = r.deposit?.bookingFee ?? 0;
    return {
      totalDeposit: depositAmount,
      totalBookingFee: bookingFee,
      totalPenalties: 0,
      netRefund: 0,
      debt: 0,
      grossRefund: 0,
      netStylistShare: Math.max(0, depositAmount - bookingFee),
    };
  }
  return computeFinance(r.financialAdjustments ?? [], price, true);
}

/**
 * Shuneh-funded admin discount allocated to a completed reservation's
 * settlement. The coupon snapshot stores the same value twice for two different
 * purposes: `discountAmount` is the concession the customer received and
 * `platformFundedAmount` is Shuneh's reimbursement to the stylist. Allocate the
 * reimbursement ONCE — adding both fields pays the discount twice. Stylist-owned
 * `discountCode` amounts have no `coupon` snapshot and are excluded.
 */
function adminDiscountSettlementAllocation(r: Record<string, any>): number {
  if (r.status === "cancelled" || !r.coupon) return 0;
  const platformFundedAmount = Number(r.coupon.platformFundedAmount ?? 0);
  return Number.isFinite(platformFundedAmount) ? platformFundedAmount : 0;
}

/** Net amount payable to the stylist for one reservation, by its status. */
function netStylistAmount(r: Record<string, any>): number {
  const finance = financeOf(r);
  if (r.status === "cancelled") return cancelledStylistPayout(finance);
  return finance.netStylistShare + adminDiscountSettlementAllocation(r);
}

/** Business rule: can THIS reservation be included in a settlement? */
function isSettleable(r: Record<string, any> | undefined): boolean {
  if (!r) return false;
  if (!SETTLABLE_PAYMENT_STATUSES.includes(r.paymentStatus)) return false;
  if (r.status === "completed") return true;
  return (
    r.status === "cancelled" &&
    hasCancellationFinance(r.financialAdjustments ?? []) &&
    cancelledStylistPayout(financeOf(r)) > 0
  );
}

function assertSettlable(r: Record<string, any> | undefined): void {
  if (!r) {
    throw AppError.badRequest(
      "یک یا چند رزرو نامعتبر یا متعلق به شما نیستند",
      "INVALID_RESERVATIONS",
    );
  }
  if (!SETTLABLE_PAYMENT_STATUSES.includes(r.paymentStatus)) {
    throw AppError.badRequest(
      "رزرو پرداخت‌شده نیست و قابل تسویه نیست",
      "RESERVATION_NOT_PAID",
    );
  }
  if (!isSettleable(r)) {
    throw AppError.badRequest(
      "فقط رزروهای انجام‌شده یا لغوشده با محاسبه‌ی سیاست لغو قابل تسویه هستند",
      "RESERVATION_NOT_SETTLABLE",
    );
  }
}

/**
 * Get the stylist's current settlement balance: the sum of exactly the same
 * per-reservation payouts exposed by `getSettlableReservations`, minus pending
 * settlement requests.
 *
 * We deliberately reuse `isSettleable` + `netStylistAmount` here instead of a
 * separate Mongo aggregation: duplicating the finance formula in aggregation
 * expressions is what allows the balance and the reservation rows to drift
 * apart (double-paid coupons, cancelled penalties treated as stylist income).
 */
export async function getSettlementBalance(stylistId: string) {
  const stylistOid = new Types.ObjectId(stylistId);
  const reservations = await Reservation.find({
    stylistId: stylistOid,
    paymentStatus: { $in: SETTLABLE_PAYMENT_STATUSES },
  })
    .select("_id status paymentStatus deposit financialAdjustments finalPrice price coupon")
    .lean();

  const excludedIds = new Set(
    (await getExcludedReservationIds(stylistId)).map(String),
  );

  let availableBalance = 0;
  let totalDeposits = 0;
  let totalCouponFunding = 0;
  let totalCancelledPenalties = 0;

  for (const r of reservations) {
    if (!isSettleable(r)) continue;
    const netAmount = netStylistAmount(r);
    // Reservations already in a non-rejected request must not be withdrawable
    // twice — including after an admin marks that request as paid.
    if (!excludedIds.has(String(r._id))) availableBalance += netAmount;
    if (r.status === "completed") {
      totalDeposits += financeOf(r).totalDeposit;
      totalCouponFunding += adminDiscountSettlementAllocation(r);
    } else if (r.status === "cancelled") {
      // Informational only: cancellation penalties are the customer's debt,
      // not stylist income, so they are NOT added to the payout.
      totalCancelledPenalties += (r.financialAdjustments ?? []).reduce(
        (sum: number, a: any) =>
          sum +
          (a.type === "penalty_cancellation" && a.direction === "debit"
            ? Number(a.amount) || 0
            : 0),
        0,
      );
    }
  }

  // Aggregate pending settlement amounts.
  const pendingPipeline = await StylistSettlement.aggregate([
    { $match: { stylistId: stylistOid, status: { $in: ["pending", "approved"] } } },
    { $group: { _id: null, total: { $sum: "$amount" }, count: { $sum: 1 } } },
  ]);
  const pendingAmount = pendingPipeline[0]?.total ?? 0;
  const pendingCount = pendingPipeline[0]?.count ?? 0;

  return {
    totalDeposits,
    totalCancelledPenalties,
    totalCouponFunding,
    pendingAmount,
    availableBalance,
    pendingCount,
  };
}

export interface SettlableReservation {
  id: string;
  serviceName: string;
  customerName: string;
  customerPhone: string;
  date: string;
  startTime: string;
  status: string;
  // Financial breakdown from finance service
  price: number;
  depositAmount: number;
  bookingFee: number;
  totalPenalties: number;
  netRefund: number;
  debt: number;
  /** Shuneh-funded coupon discount reimbursed to the stylist. */
  couponFunding: number;
  /** Net amount payable to stylist for this reservation */
  netAmount: number;
}

/**
 * Get all reservations that are eligible for settlement.
 * These are completed paid reservations not yet in any settlement (pending,
 * approved, or paid), plus cancelled reservations whose payout was computed
 * per the reservation's cancellation policy and is still positive.
 */
export async function getSettlableReservations(
  stylistId: string,
): Promise<SettlableReservation[]> {
  // Get all settled/pending reservation IDs
  const excludedIds = await getExcludedReservationIds(stylistId);

  // Step 1: Find ALL reservations for this stylist
  const allReservations = await Reservation.find({
    stylistId: new Types.ObjectId(stylistId),
  })
    .select(
      "_id status paymentStatus deposit financialAdjustments finalPrice price coupon date startTime serviceId serviceIds customerId",
    )
    .lean();

  // Only performed bookings and policy-cancelled bookings with a positive
  // payout are settleable. Same predicate as the balance endpoint.
  const eligibleReservations = allReservations.filter((r) => isSettleable(r));

  // Step 4: Exclude already settled reservations
  const excludedIdStrings = excludedIds.map(String);
  const availableReservations = eligibleReservations.filter(
    (r) => !excludedIdStrings.includes(String(r._id)),
  );

  // Populate service and customer info for available reservations
  let populatedReservations: any[] = [];
  if (availableReservations.length > 0) {
    populatedReservations = await Reservation.find({
      _id: { $in: availableReservations.map((r) => r._id) },
    })
      .populate("serviceId", "name")
      .populate("customerId", "firstName lastName phone")
      .populate("serviceIds", "name")
      .lean();
  }

  // Compute finance for each reservation to get accurate net amount
  const results: SettlableReservation[] = [];
  // Batch-load all services for eligible reservations (fixes N+1).
  const allServiceIds = new Set<string>();
  for (const r of populatedReservations) {
    const sIds = r.serviceIds?.length
      ? r.serviceIds.map((s: any) => String(s._id ?? s))
      : [String(r.serviceId)];
    for (const id of sIds) allServiceIds.add(id);
  }
  const allServices = allServiceIds.size > 0
    ? await require("../../models/Service").Service.find({ _id: { $in: [...allServiceIds] } }).select("name").lean()
    : [];
  const serviceMapById = new Map<string, any>(allServices.map((s: any) => [String(s._id), s]));

  for (const r of populatedReservations) {
    const serviceIds = r.serviceIds?.length
      ? r.serviceIds.map((s: any) => s._id ?? s)
      : [r.serviceId];
    const serviceNames = serviceIds
      .map((id: any) => serviceMapById.get(String(id))?.name)
      .filter(Boolean)
      .join("، ");

    const customer = r.customerId as any;
    const customerName = customer
      ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim()
      : "مشتری";

    const price = r.finalPrice ?? r.price ?? 0;

    const finance = financeOf(r);
    // For cancelled reservations: stylist's share = deposit minus refund (penalty is customer's debt, not stylist income)
    const netAmount = netStylistAmount(r);

    // Parse date safely
    let dateStr = "";
    if (r.date) {
      try {
        dateStr = new Date(r.date).toISOString().split("T")[0];
      } catch {
        dateStr = "";
      }
    }

    results.push({
      id: String(r._id),
      serviceName: serviceNames || (r.serviceId as any)?.name || "خدمات",
      customerName,
      customerPhone: customer?.phone ?? "",
      date: dateStr,
      startTime: r.startTime,
      status: r.status,
      price,
      depositAmount: finance.totalDeposit,
      bookingFee: finance.totalBookingFee,
      totalPenalties: finance.totalPenalties,
      netRefund: finance.netRefund,
      debt: finance.debt,
      // Platform funding is only reimbursed for performed bookings.
      couponFunding:
        r.status === "cancelled" ? 0 : (r.coupon?.platformFundedAmount ?? 0),
      netAmount,
    });
  }

  return results;
}

async function getExcludedReservationIds(
  stylistId: string,
): Promise<Types.ObjectId[]> {
  // Exclude reservations in any settlement that is not rejected
  const settlements = await StylistSettlement.find({
    stylistId: new Types.ObjectId(stylistId),
    status: { $in: ["pending", "approved", "paid"] },
  })
    .select("depositReservationIds status")
    .lean();

  const ids: Types.ObjectId[] = [];
  for (const s of settlements) {
    ids.push(...s.depositReservationIds);
  }
  return ids;
}

export interface CreateSettlementInput {
  amount?: number;
  depositReservationIds?: string[];
}

/**
 * Create a settlement request. The stylist can only request up to their
 * available balance.
 * If depositReservationIds is provided, settle those specific reservations.
 * Otherwise, auto-select all available reservations up to the requested amount.
 */
export async function createSettlementRequest(
  stylistId: string,
  input: CreateSettlementInput,
) {
  let amount: number;
  let reservationIds: Types.ObjectId[];

  if (input.depositReservationIds && input.depositReservationIds.length > 0) {
    // Validate provided reservation IDs
    const providedIds = input.depositReservationIds.map(
      (id) => new Types.ObjectId(id),
    );

    // All reservations must belong to this stylist.
    const reservations = await Reservation.find({
      _id: { $in: providedIds },
      stylistId: new Types.ObjectId(stylistId),
    })
      .select("_id paymentStatus status financialAdjustments finalPrice price deposit coupon")
      .lean();

    if (reservations.length !== providedIds.length) {
      throw AppError.badRequest(
        "یک یا چند رزرو نامعتبر یا متعلق به شما نیستند",
        "INVALID_RESERVATIONS",
      );
    }

    // Business rules: only completed reservations, or cancelled ones whose
    // payout was computed per the reservation's cancellation policy.
    for (const r of reservations) {
      assertSettlable(r);
    }

    // Check none are already in a non-rejected settlement
    const settledIds = await getExcludedReservationIds(stylistId);
    const alreadySettled = providedIds.some((id) =>
      settledIds.some((sid) => sid.equals(id)),
    );
    if (alreadySettled) {
      throw AppError.badRequest(
        "یک یا چند رزرو انتخاب‌شده قبلاً در تسویه دیگری هستند",
        "RESERVATIONS_ALREADY_SETTLED",
      );
    }

    // Calculate total net amount from finance
    amount = 0;
    for (const r of reservations) {
      amount += netStylistAmount(r);
    }
    amount = Math.trunc(amount);

    reservationIds = reservations.map((r) => r._id);
  } else {
    // Legacy: amount-only request (auto-select)
    amount = Math.trunc(input.amount!);
    if (!Number.isFinite(amount) || amount <= 0) {
      throw AppError.badRequest("مبلغ نامعتبر است", "INVALID_AMOUNT");
    }

    const balance = await getSettlementBalance(stylistId);
    if (amount > balance.availableBalance) {
      throw AppError.badRequest(
        "موجودی قابل برداشت کافی نیست",
        "INSUFFICIENT_BALANCE",
      );
    }

    // Auto-select reservations up to the amount. Only completed reservations,
    // or cancelled ones whose policy-based payout was applied at cancel time.
    const availableReservations = await Reservation.find({
      stylistId: new Types.ObjectId(stylistId),
      paymentStatus: { $in: SETTLABLE_PAYMENT_STATUSES },
      $or: [
        { status: "completed" },
        {
          status: "cancelled",
          "financialAdjustments.type": { $in: ["refund", "penalty_cancellation"] },
        },
      ],
      _id: { $nin: await getSettledReservationIds(stylistId) },
    })
      .select("_id financialAdjustments finalPrice price status deposit coupon")
      .lean();

    let runningTotal = 0;
    reservationIds = [];
    for (const r of availableReservations) {
      const net = netStylistAmount(r);
      if (net <= 0) continue;
      if (runningTotal + net <= amount) {
        runningTotal += net;
        reservationIds.push(r._id);
      }
      if (runningTotal >= amount) break;
    }

    amount = Math.trunc(runningTotal);
  }

  if (reservationIds.length === 0) {
    throw AppError.badRequest(
      "هیچ رزرو قابل تسویه‌ای یافت نشد",
      "NO_SETTLABLE_RESERVATIONS",
    );
  }

  const settlement = await StylistSettlement.create({
    stylistId: new Types.ObjectId(stylistId),
    amount,
    depositReservationIds: reservationIds,
    status: "pending",
  });

  // Notify admins about new settlement request.
  void notifyAdminsNewSettlement(stylistId, amount);

  return serializeSettlement(settlement);
}

async function getSettledReservationIds(
  stylistId: string,
): Promise<Types.ObjectId[]> {
  const settled = await StylistSettlement.find({
    stylistId: new Types.ObjectId(stylistId),
    status: { $in: ["approved", "paid"] },
  })
    .select("depositReservationIds")
    .lean();
  const ids: Types.ObjectId[] = [];
  for (const s of settled) {
    ids.push(...s.depositReservationIds);
  }
  return ids;
}

/**
 * List the stylist's own settlement requests with reservation details.
 */
export async function listStylistSettlements(stylistId: string) {
  const items = await StylistSettlement.find({
    stylistId: new Types.ObjectId(stylistId),
  })
    .sort({ createdAt: -1 })
    .lean();

  const results = [];
  for (const s of items) {
    const reservationDetails = await getReservationDetails(
      s.depositReservationIds ?? [],
    );
    results.push({
      ...serializeSettlement(s),
      reservations: reservationDetails,
    });
  }

  return results;
}

/**
 * Admin: list all settlement requests with reservation details.
 */
export async function adminListSettlements(status?: SettlementStatus) {
  const filter: Record<string, unknown> = {};
  if (status) filter.status = status;

  const items = await StylistSettlement.find(filter)
    .sort({ createdAt: -1 })
    .populate("stylistId", "firstName lastName phone")
    .lean();

  const results = [];
  for (const s of items) {
    const reservationDetails = await getReservationDetails(
      s.depositReservationIds ?? [],
    );
    results.push({
      ...serializeSettlement(s),
      reservations: reservationDetails,
      stylist: s.stylistId
        ? {
            id: String(s.stylistId._id),
            fullName:
              `${(s.stylistId as unknown as { firstName?: string }).firstName ?? ""} ${(s.stylistId as unknown as { lastName?: string }).lastName ?? ""}`.trim() ||
              "متخصص",
            phone: (s.stylistId as unknown as { phone?: string }).phone ?? null,
          }
        : null,
    });
  }

  return results;
}

async function getReservationDetails(
  reservationIds: Types.ObjectId[],
): Promise<any[]> {
  if (!reservationIds.length) return [];

  const reservations = await Reservation.find({
    _id: { $in: reservationIds },
  })
    .populate("serviceId", "name")
    .populate("customerId", "firstName lastName phone")
    .populate("serviceIds", "name")
    .select(
      "serviceId serviceIds customerId date startTime status finalPrice price financialAdjustments coupon",
    )
    .lean();

  const details = [];
  for (const r of reservations) {
    const serviceIds = r.serviceIds?.length
      ? r.serviceIds.map((s: any) => s._id ?? s)
      : [r.serviceId];
    const services = await Promise.all(
      serviceIds.map((id: Types.ObjectId) =>
        require("../../models/Service")
          .Service.findById(id)
          .select("name")
          .lean(),
      ),
    );
    const serviceNames = services
      .filter(Boolean)
      .map((s: any) => s.name)
      .join("، ");

    const customer = r.customerId as any;
    const customerName = customer
      ? `${customer.firstName ?? ""} ${customer.lastName ?? ""}`.trim()
      : "مشتری";

    const price = r.finalPrice ?? r.price ?? 0;
    const finance = financeOf(r);
    const netAmount = netStylistAmount(r);

    details.push({
      id: String(r._id),
      serviceName: serviceNames || (r.serviceId as any)?.name || "خدمات",
      customerName,
      customerPhone: customer?.phone ?? "",
      date: r.date?.toISOString().split("T")[0] || "",
      startTime: r.startTime,
      status: r.status,
      price,
      depositAmount: finance.totalDeposit,
      bookingFee: finance.totalBookingFee,
      totalPenalties: finance.totalPenalties,
      netRefund: finance.netRefund,
      debt: finance.debt,
      // Platform funding is only reimbursed for performed bookings.
      couponFunding:
        r.status === "cancelled" ? 0 : (r.coupon?.platformFundedAmount ?? 0),
      netAmount,
    });
  }

  return details;
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
    throw AppError.badRequest("شناسه‌ی نامعتبر", "INVALID_ID");
  }

  const settlement = await StylistSettlement.findById(settlementId);
  if (!settlement) {
    throw AppError.notFound("درخواست تسویه یافت نشد", "SETTLEMENT_NOT_FOUND");
  }

  if (settlement.status === "paid" || settlement.status === "rejected") {
    throw AppError.badRequest(
      "این درخواست قبلاً پردازش شده است",
      "SETTLEMENT_ALREADY_PROCESSED",
    );
  }

  const previousStatus = settlement.status;
  settlement.status = input.status;
  settlement.processedBy = new Types.ObjectId(adminId);
  settlement.processedAt = new Date();
  if (input.adminNote) settlement.adminNote = input.adminNote;
  if (input.status === "paid") settlement.paidAt = new Date();

  await settlement.save();

  // Notify the stylist about the status change.
  void notifyStylistSettlementStatus(
    String(settlement.stylistId),
    settlement.amount,
    input.status,
    input.adminNote,
  );

  // Return with reservation details
  const reservationDetails = await getReservationDetails(
    settlement.depositReservationIds ?? [],
  );

  return {
    ...serializeSettlement(settlement),
    reservations: reservationDetails,
  };
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
    processedAt: s.processedAt
      ? s.processedAt instanceof Date
        ? s.processedAt.toISOString()
        : s.processedAt
      : null,
    paidAt: s.paidAt
      ? s.paidAt instanceof Date
        ? s.paidAt.toISOString()
        : s.paidAt
      : null,
    createdAt:
      s.createdAt instanceof Date ? s.createdAt.toISOString() : s.createdAt,
    updatedAt:
      s.updatedAt instanceof Date ? s.updatedAt.toISOString() : s.updatedAt,
  };
}

async function notifyAdminsNewSettlement(stylistId: string, amount: number) {
  try {
    const admins = await User.find({ roles: "admin" }).select("phone").lean();
    for (const admin of admins) {
      if (admin.phone) {
        void notificationService.adminNewSettlementRequest(admin.phone, {
          stylistId,
          amount,
        });
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
    const stylist = await User.findById(stylistId).select("phone").lean();
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
