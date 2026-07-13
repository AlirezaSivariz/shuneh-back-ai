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
 * Get the stylist's current settlement balance: total confirmed deposits
 * that are not yet settled, minus pending settlement requests.
 */
export async function getSettlementBalance(stylistId: string) {
  // All paid deposits on confirmed/completed reservations where no
  // cancellation refund was issued (cancellationOutcome.settled !== true).
  const reservations = await Reservation.find({
    stylistId: new Types.ObjectId(stylistId),
    paymentStatus: "paid",
    status: { $in: ["confirmed", "completed"] },
  })
    .select("deposit")
    .lean();

  const totalDeposits = reservations.reduce(
    (sum, r) => sum + ((r.deposit?.amount ?? 0) - (r.deposit?.bookingFee ?? 0)),
    0,
  );

  // Pending/approved (not yet paid/rejected) settlement amounts.
  const pendingSettlements = await StylistSettlement.find({
    stylistId: new Types.ObjectId(stylistId),
    status: { $in: ["pending", "approved"] },
  })
    .select("amount")
    .lean();

  const pendingAmount = pendingSettlements.reduce(
    (sum, s) => sum + s.amount,
    0,
  );
  const availableBalance = Math.max(0, totalDeposits - pendingAmount);

  return {
    totalDeposits,
    pendingAmount,
    availableBalance,
    pendingCount: pendingSettlements.length,
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
  /** Net amount payable to stylist for this reservation */
  netAmount: number;
}

/**
 * Get all reservations that are eligible for settlement.
 * These are completed/confirmed paid reservations not yet in any settlement
 * (pending, approved, or paid).
 */
export async function getSettlableReservations(
  stylistId: string,
): Promise<SettlableReservation[]> {
  console.log("[Settlement] ===== getSettlableReservations START =====");
  console.log("[Settlement] Stylist ID:", stylistId);

  // Get all settled/pending reservation IDs
  const excludedIds = await getExcludedReservationIds(stylistId);
  console.log(
    "[Settlement] Excluded reservation IDs (in pending/approved/paid):",
    excludedIds.map(String),
  );

  // Step 1: Find ALL reservations for this stylist
  const allReservations = await Reservation.find({
    stylistId: new Types.ObjectId(stylistId),
  })
    .select(
      "_id status paymentStatus deposit financialAdjustments finalPrice price date startTime serviceId serviceIds customerId",
    )
    .lean();
  console.log(
    "[Settlement] Total reservations for stylist:",
    allReservations.length,
  );
  console.log(
    "[Settlement] All reservations:",
    allReservations.map((r) => ({
      id: String(r._id),
      status: r.status,
      paymentStatus: r.paymentStatus,
      hasFinancialAdjustments: !!r.financialAdjustments?.length,
      deposit: r.deposit,
    })),
  );

  // DEBUG: Show all unique statuses in database for this stylist
  const uniqueStatuses = [...new Set(allReservations.map((r) => r.status))];
  const uniquePaymentStatuses = [
    ...new Set(allReservations.map((r) => r.paymentStatus)),
  ];
  console.log("[Settlement] Unique statuses in DB:", uniqueStatuses);
  console.log(
    "[Settlement] Unique paymentStatuses in DB:",
    uniquePaymentStatuses,
  );

  // Step 2: Filter by paymentStatus = paid OR not_required
  // paid = online payment completed
  // not_required = no online payment (free service or on-site payment only) but deposit/financialAdjustments exist
  const validPaymentStatuses = ["paid", "not_required"];
  const validPaymentReservations = allReservations.filter((r) =>
    validPaymentStatuses.includes(r.paymentStatus),
  );
  console.log(
    "[Settlement] After paymentStatus filter (paid/not_required):",
    validPaymentReservations.length,
  );

  // Step 3: Filter by status = completed or confirmed
  const completedReservations = validPaymentReservations.filter((r) =>
    ["completed", "confirmed"].includes(r.status),
  );
  console.log(
    "[Settlement] After status=completed/confirmed filter:",
    completedReservations.length,
  );

  // Step 4: Exclude already settled reservations
  const excludedIdStrings = excludedIds.map(String);
  const availableReservations = completedReservations.filter(
    (r) => !excludedIdStrings.includes(String(r._id)),
  );
  console.log(
    "[Settlement] After excluded IDs filter:",
    availableReservations.length,
  );
  console.log(
    "[Settlement] Available reservation IDs:",
    availableReservations.map((r) => String(r._id)),
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
    console.log(
      "[Settlement] Populated reservations count:",
      populatedReservations.length,
    );
  } else {
    console.log("[Settlement] No available reservations after filtering");
  }

  // Compute finance for each reservation to get accurate net amount
  const results: SettlableReservation[] = [];
  for (const r of populatedReservations) {
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

    // If no financial adjustments exist (legacy data), fall back to deposit snapshot
    let finance;
    if (!r.financialAdjustments || r.financialAdjustments.length === 0) {
      const depositAmount = r.deposit?.amount ?? 0;
      const bookingFee = r.deposit?.bookingFee ?? 0;
      finance = {
        totalDeposit: depositAmount,
        totalBookingFee: bookingFee,
        totalPenalties: 0,
        netRefund: 0,
        debt: 0,
        netStylistShare: Math.max(0, depositAmount - bookingFee),
      } as any;
    } else {
      finance = computeFinance(r.financialAdjustments ?? [], price, true);
    }

    // Parse date safely
    let dateStr = "";
    if (r.date) {
      try {
        dateStr = new Date(r.date).toISOString().split("T")[0];
      } catch {
        dateStr = "";
      }
    }

    console.log("[Settlement] Reservation computed:", {
      id: String(r._id),
      serviceName: serviceNames || (r.serviceId as any)?.name || "خدمات",
      customerName,
      date: dateStr,
      startTime: r.startTime,
      status: r.status,
      price,
      depositAmount: finance.totalDeposit,
      bookingFee: finance.totalBookingFee,
      totalPenalties: finance.totalPenalties,
      netRefund: finance.netRefund,
      debt: finance.debt,
      netAmount: finance.netStylistShare,
    });

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
      netAmount: finance.netStylistShare,
    });
  }

  console.log("[Settlement] Final results count:", results.length);
  console.log("[Settlement] ===== getSettlableReservations END =====");
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

  console.log(
    "[Settlement] Found settlements with pending/approved/paid:",
    settlements.map((s) => ({
      id: String(s._id),
      status: s.status,
      reservationIds: s.depositReservationIds?.map(String) ?? [],
    })),
  );

  const ids: Types.ObjectId[] = [];
  for (const s of settlements) {
    ids.push(...s.depositReservationIds);
  }
  console.log("[Settlement] Total excluded reservation IDs:", ids.map(String));
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

    // Check all reservations belong to stylist, are paid (or not_required), completed/confirmed, and not already settled
    const reservations = await Reservation.find({
      _id: { $in: providedIds },
      stylistId: new Types.ObjectId(stylistId),
      paymentStatus: { $in: ["paid", "not_required"] },
      status: { $in: ["confirmed", "completed"] },
    })
      .select("_id financialAdjustments finalPrice price")
      .lean();

    if (reservations.length !== providedIds.length) {
      throw AppError.badRequest(
        "یک یا چند رزرو نامعتبر یا متعلق به شما نیستند",
        "INVALID_RESERVATIONS",
      );
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
      const price = r.finalPrice ?? r.price ?? 0;
      const finance = computeFinance(r.financialAdjustments ?? [], price, true);
      amount += finance.netStylistShare;
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

    // Auto-select reservations up to the amount
    const availableReservations = await Reservation.find({
      stylistId: new Types.ObjectId(stylistId),
      paymentStatus: { $in: ["paid", "not_required"] },
      status: { $in: ["confirmed", "completed"] },
      _id: { $nin: await getSettledReservationIds(stylistId) },
    })
      .select("_id financialAdjustments finalPrice price")
      .lean();

    let runningTotal = 0;
    reservationIds = [];
    for (const r of availableReservations) {
      const price = r.finalPrice ?? r.price ?? 0;
      const finance = computeFinance(r.financialAdjustments ?? [], price, true);
      if (runningTotal + finance.netStylistShare <= amount) {
        runningTotal += finance.netStylistShare;
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
      "serviceId serviceIds customerId date startTime status finalPrice price financialAdjustments",
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
    const finance = computeFinance(r.financialAdjustments ?? [], price, true);

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
      netAmount: finance.netStylistShare,
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
