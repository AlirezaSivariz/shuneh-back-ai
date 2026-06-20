/**
 * Admin (support) operations: global read views, conservative write actions,
 * and an append-only audit log. Every write goes through `audit()`.
 *
 * Sensitive fields (e.g. nationalCode) are returned ONLY here, to admins.
 * All date filters are on `reservation.date` (an Iran calendar day stored at
 * its UTC midnight); the timezone is fixed (Iran).
 */
import { Types } from 'mongoose';
import { User, Role, ROLES } from '../../models/User';
import { StylistProfile, IStylistProfile } from '../../models/StylistProfile';
import { StylistSalon } from '../../models/StylistSalon';
import { StylistService } from '../../models/StylistService';
import { Salon } from '../../models/Salon';
import { Service } from '../../models/Service';
import { Reservation, IReservation, ReservationStatus, RESERVATION_STATUSES } from '../../models/Reservation';
import { DiscountCode } from '../../models/DiscountCode';
import { AuditLog } from '../../models/AuditLog';
import { AppError } from '../../utils/AppError';
import { notificationService } from '../../utils/notification';
import { storageProvider } from '../../utils/storage';
import { accountStatus } from '../../utils/foreignApproval';

// ───────────────────────── helpers ─────────────────────────

interface PageQuery {
  page?: number;
  limit?: number;
}

function paginate(q: PageQuery) {
  const page = Math.max(1, Number(q.page) || 1);
  const limit = Math.min(100, Math.max(1, Number(q.limit) || 20));
  return { page, limit, skip: (page - 1) * limit };
}

function pageMeta(page: number, limit: number, total: number) {
  return { page, limit, total, totalPages: Math.ceil(total / limit) };
}

function escapeRegex(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function dayRange(from?: string, to?: string) {
  const r: Record<string, Date> = {};
  if (from) r.$gte = new Date(`${from}T00:00:00.000Z`);
  if (to) r.$lte = new Date(`${to}T00:00:00.000Z`);
  return r;
}

function fullName(u?: { firstName?: string | null; lastName?: string | null } | null) {
  if (!u) return null;
  return `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || null;
}

/** Append an immutable audit record. Never throws into the caller. */
async function audit(
  adminId: string,
  action: string,
  targetType: string,
  targetId: string,
  summary?: Record<string, unknown>,
) {
  try {
    await AuditLog.create({
      adminId: new Types.ObjectId(adminId),
      action,
      targetType,
      targetId,
      summary: summary ?? null,
    });
  } catch {
    /* auditing must not break the action */
  }
}

// ───────────────────────── users ─────────────────────────

export async function listUsers(filter: { role?: Role; search?: string } & PageQuery) {
  const { page, limit, skip } = paginate(filter);
  const q: Record<string, unknown> = {};
  if (filter.role) q.roles = filter.role;
  if (filter.search) {
    const rx = new RegExp(escapeRegex(filter.search), 'i');
    q.$or = [{ phone: rx }, { firstName: rx }, { lastName: rx }];
  }

  const [items, total] = await Promise.all([
    User.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(q),
  ]);

  return {
    items: items.map((u) => {
      const status = accountStatus(u);
      return {
        id: String(u._id),
        phone: u.phone,
        roles: u.roles,
        // The admin-disable flag (drives the enable/disable toggle).
        isActive: u.isActive !== false,
        // Effective status: a not-yet-approved foreign national is NOT active,
        // even though the admin-disable flag is still true.
        accountActive: status.active,
        inactiveReason: status.reason,
        isForeignNational: u.isForeignNational ?? false,
        foreignApprovalStatus: u.foreignApprovalStatus ?? 'not_required',
        fullName: fullName(u),
        createdAt: u.createdAt,
      };
    }),
    ...pageMeta(page, limit, total),
  };
}

export async function getUser(id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const user = await User.findById(id).lean();
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');

  const [profile, ownedSalons, memberships, services] = await Promise.all([
    StylistProfile.findOne({ userId: id }).lean(),
    Salon.find({ ownerId: id }).select('name address status').lean(),
    StylistSalon.find({ stylistId: id }).populate('salonId', 'name status').lean(),
    StylistService.find({ stylistId: id }).populate('serviceId', 'name').lean(),
  ]);

  return {
    user: {
      id: String(user._id),
      phone: user.phone,
      roles: user.roles,
      isActive: user.isActive !== false,
      accountActive: accountStatus(user).active,
      inactiveReason: accountStatus(user).reason,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      nationalCode: user.nationalCode ?? null, // admin-only sensitive field
      birthDate: user.birthDate ?? null,
      isForeignNational: user.isForeignNational ?? false,
      foreignId: user.foreignId ?? null, // admin-only sensitive field
      foreignApprovalStatus: user.foreignApprovalStatus ?? 'not_required',
      foreignRejectionReason: user.foreignRejectionReason ?? null,
      createdAt: user.createdAt,
    },
    stylistProfile: profile
      ? {
          status: profile.status,
          onboardingStep: profile.onboardingStep,
          isAcceptingReservations: profile.isAcceptingReservations !== false,
          ratingAverage: profile.ratingAverage,
          ratingCount: profile.ratingCount,
          isPromoted: profile.isPromoted,
          promotedUntil: profile.promotedUntil,
        }
      : null,
    ownedSalons: ownedSalons.map((s) => ({
      id: String(s._id),
      name: s.name,
      address: s.address ?? null,
      status: s.status,
    })),
    salonMemberships: memberships.map((m) => {
      const salon = m.salonId as unknown as { _id: Types.ObjectId; name: string; status: string } | null;
      return {
        membershipStatus: m.status,
        salon: salon ? { id: String(salon._id), name: salon.name, status: salon.status } : null,
      };
    }),
    services: services
      .map((ss) => {
        const svc = ss.serviceId as unknown as { _id: Types.ObjectId; name: string } | null;
        return svc ? { id: String(svc._id), name: svc.name } : null;
      })
      .filter(Boolean),
  };
}

export async function setUserStatus(adminId: string, id: string, isActive: boolean) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  if (id === adminId) {
    throw AppError.badRequest('نمی‌توانید حساب خودتان را غیرفعال کنید', 'CANNOT_DISABLE_SELF');
  }
  const user = await User.findById(id);
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');

  user.isActive = isActive;
  await user.save();
  await audit(adminId, 'user.setStatus', 'user', id, { isActive });
  return { id, isActive };
}

// ─────────────────── foreign-national approvals ───────────────────

/** List foreign-national users by approval status (default: pending). */
export async function listForeignApprovals(
  filter: { status?: 'pending' | 'approved' | 'rejected' } & PageQuery,
) {
  const { page, limit, skip } = paginate(filter);
  const status = filter.status ?? 'pending';
  const q = { isForeignNational: true, foreignApprovalStatus: status };

  const [items, total] = await Promise.all([
    User.find(q).sort({ updatedAt: -1 }).skip(skip).limit(limit).lean(),
    User.countDocuments(q),
  ]);

  return {
    items: items.map((u) => ({
      id: String(u._id),
      fullName: fullName(u),
      phone: u.phone,
      roles: u.roles,
      foreignId: u.foreignId ?? null,
      foreignApprovalStatus: u.foreignApprovalStatus,
      foreignRejectionReason: u.foreignRejectionReason ?? null,
      createdAt: u.createdAt,
    })),
    ...pageMeta(page, limit, total),
  };
}

/** Load a foreign user for an approval decision (validates they ARE foreign). */
async function loadForeignUser(id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const user = await User.findById(id);
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');
  if (!user.isForeignNational) {
    throw AppError.badRequest('این کاربر از اتباع نیست', 'NOT_FOREIGN_NATIONAL');
  }
  return user;
}

export async function approveForeign(adminId: string, id: string) {
  const user = await loadForeignUser(id);
  user.foreignApprovalStatus = 'approved';
  user.foreignRejectionReason = null;
  await user.save();
  await audit(adminId, 'foreignNational.approve', 'user', id);

  void (async () => {
    if (user.phone) void notificationService.foreignApprovalDecided(user.phone, { approved: true });
  })();

  return { id, foreignApprovalStatus: user.foreignApprovalStatus };
}

export async function rejectForeign(adminId: string, id: string, reason?: string) {
  const user = await loadForeignUser(id);
  user.foreignApprovalStatus = 'rejected';
  user.foreignRejectionReason = reason ?? null;
  await user.save();
  await audit(adminId, 'foreignNational.reject', 'user', id, { reason: reason ?? null });

  void (async () => {
    if (user.phone) {
      void notificationService.foreignApprovalDecided(user.phone, { approved: false, reason });
    }
  })();

  return { id, foreignApprovalStatus: user.foreignApprovalStatus };
}

// ───────────────────────── reservations ─────────────────────────

/** Bulk-enrich reservations with customer/stylist/salon/service names. */
async function enrichReservations(rows: IReservation[]) {
  const userIds = new Set<string>();
  const salonIds = new Set<string>();
  const serviceIds = new Set<string>();
  for (const r of rows) {
    userIds.add(String(r.customerId));
    userIds.add(String(r.stylistId));
    if (r.salonId) salonIds.add(String(r.salonId));
    for (const id of r.serviceIds?.length ? r.serviceIds : [r.serviceId]) serviceIds.add(String(id));
  }

  const [users, salons, services] = await Promise.all([
    User.find({ _id: { $in: [...userIds] } }).select('firstName lastName phone').lean(),
    Salon.find({ _id: { $in: [...salonIds] } }).select('name').lean(),
    Service.find({ _id: { $in: [...serviceIds] } }).select('name').lean(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const salonById = new Map(salons.map((s) => [String(s._id), s]));
  const serviceById = new Map(services.map((s) => [String(s._id), s]));

  return rows.map((r) => {
    const cust = userById.get(String(r.customerId));
    const sty = userById.get(String(r.stylistId));
    const salon = r.salonId ? salonById.get(String(r.salonId)) : null;
    const ids = r.serviceIds?.length ? r.serviceIds : [r.serviceId];
    return {
      id: String(r._id),
      status: r.status,
      date: r.date.toISOString().slice(0, 10),
      startTime: r.startTime,
      endTime: r.endTime,
      price: r.price ?? null,
      discount: r.discountCode
        ? { code: r.discountCode, amount: r.discountAmount ?? 0, finalPrice: r.finalPrice ?? null }
        : null,
      customerNote: r.customerNote ?? null,
      customer: cust
        ? { id: String(cust._id), fullName: fullName(cust) ?? 'مشتری', phone: cust.phone }
        : { id: String(r.customerId), fullName: 'مشتری', phone: null },
      stylist: sty
        ? { id: String(sty._id), fullName: fullName(sty) ?? 'متخصص' }
        : { id: String(r.stylistId), fullName: 'متخصص' },
      salon: salon ? { id: String(salon._id), name: salon.name } : null,
      services: ids
        .map((id) => serviceById.get(String(id)))
        .filter(Boolean)
        .map((s) => ({ id: String(s!._id), name: s!.name })),
      cancelledBy: r.cancelledBy ?? null,
      cancelReason: r.cancelReason ?? null,
      createdAt: r.createdAt,
    };
  });
}

export async function listReservations(
  filter: {
    from?: string;
    to?: string;
    status?: ReservationStatus;
    stylistId?: string;
    customerId?: string;
    salonId?: string;
  } & PageQuery,
) {
  const { page, limit, skip } = paginate(filter);
  const q: Record<string, unknown> = {};
  const range = dayRange(filter.from, filter.to);
  if (Object.keys(range).length) q.date = range;
  if (filter.status) q.status = filter.status;
  if (filter.stylistId) q.stylistId = new Types.ObjectId(filter.stylistId);
  if (filter.customerId) q.customerId = new Types.ObjectId(filter.customerId);
  if (filter.salonId) q.salonId = new Types.ObjectId(filter.salonId);

  const [rows, total] = await Promise.all([
    Reservation.find(q).sort({ startAt: -1 }).skip(skip).limit(limit).lean(),
    Reservation.countDocuments(q),
  ]);

  return { items: await enrichReservations(rows as unknown as IReservation[]), ...pageMeta(page, limit, total) };
}

export async function getReservation(id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const r = await Reservation.findById(id).lean();
  if (!r) throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');
  const [enriched] = await enrichReservations([r as unknown as IReservation]);
  return enriched;
}

export async function cancelReservation(adminId: string, id: string, reason?: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const reservation = await Reservation.findById(id);
  if (!reservation) throw AppError.notFound('رزرو یافت نشد', 'RESERVATION_NOT_FOUND');
  if (['cancelled', 'completed', 'no_show'].includes(reservation.status)) {
    throw AppError.badRequest('این رزرو قابل لغو نیست', 'NOT_CANCELLABLE');
  }

  reservation.status = 'cancelled';
  reservation.cancelledBy = 'admin';
  reservation.cancelReason = reason ?? 'cancelled_by_admin';
  await reservation.save();

  // Notify BOTH parties (best-effort).
  void (async () => {
    const parties = await User.find({ _id: { $in: [reservation.customerId, reservation.stylistId] } })
      .select('phone')
      .lean();
    for (const p of parties) {
      if (p.phone) {
        void notificationService.reservationCancelled(p.phone, {
          date: reservation.date.toISOString().slice(0, 10),
          startTime: reservation.startTime,
          reason: 'لغو توسط پشتیبانی',
        });
      }
    }
  })();

  await audit(adminId, 'reservation.cancel', 'reservation', id, { reason: reason ?? null });
  return getReservation(id);
}

// ───────────────────────── salons & stylists ─────────────────────────

export async function listSalons(filter: { search?: string; status?: string } & PageQuery) {
  const { page, limit, skip } = paginate(filter);
  const q: Record<string, unknown> = {};
  if (filter.status) q.status = filter.status;
  if (filter.search) q.name = new RegExp(escapeRegex(filter.search), 'i');

  const [salons, total] = await Promise.all([
    Salon.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Salon.countDocuments(q),
  ]);

  const ownerIds = salons.map((s) => s.ownerId).filter(Boolean);
  const salonIds = salons.map((s) => s._id);
  const [owners, memberships] = await Promise.all([
    User.find({ _id: { $in: ownerIds } }).select('firstName lastName phone').lean(),
    StylistSalon.find({ salonId: { $in: salonIds } }).select('salonId status').lean(),
  ]);
  const ownerById = new Map(owners.map((u) => [String(u._id), u]));
  const countBySalon = new Map<string, number>();
  for (const m of memberships) {
    const k = String(m.salonId);
    countBySalon.set(k, (countBySalon.get(k) ?? 0) + 1);
  }

  return {
    items: salons.map((s) => {
      const owner = s.ownerId ? ownerById.get(String(s.ownerId)) : null;
      return {
        id: String(s._id),
        name: s.name,
        address: s.address ?? null,
        status: s.status,
        owner: owner
          ? { id: String(s.ownerId), fullName: fullName(owner), phone: owner.phone }
          : null,
        stylistCount: countBySalon.get(String(s._id)) ?? 0,
      };
    }),
    ...pageMeta(page, limit, total),
  };
}

export async function listStylists(filter: { search?: string; status?: string } & PageQuery) {
  const { page, limit, skip } = paginate(filter);
  const q: Record<string, unknown> = {};
  if (filter.status) q.status = filter.status;

  const [profiles, total] = await Promise.all([
    StylistProfile.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    StylistProfile.countDocuments(q),
  ]);

  const userIds = profiles.map((p) => p.userId);
  const [users, memberships] = await Promise.all([
    User.find({ _id: { $in: userIds } }).select('firstName lastName phone').lean(),
    StylistSalon.find({ stylistId: { $in: userIds } }).select('stylistId status').lean(),
  ]);
  const userById = new Map(users.map((u) => [String(u._id), u]));
  const salonsByStylist = new Map<string, number>();
  for (const m of memberships) {
    const k = String(m.stylistId);
    salonsByStylist.set(k, (salonsByStylist.get(k) ?? 0) + 1);
  }

  let items = profiles.map((p) => {
    const u = userById.get(String(p.userId));
    return {
      id: String(p.userId),
      fullName: fullName(u) ?? 'متخصص',
      phone: u?.phone ?? null,
      status: p.status,
      isAcceptingReservations: p.isAcceptingReservations !== false,
      rating: p.ratingAverage ?? 0,
      ratingCount: p.ratingCount ?? 0,
      isPromoted: p.isPromoted,
      promotedUntil: p.promotedUntil,
      salonCount: salonsByStylist.get(String(p.userId)) ?? 0,
    };
  });
  if (filter.search) {
    const s = filter.search.toLowerCase();
    items = items.filter(
      (i) => i.fullName.toLowerCase().includes(s) || (i.phone ?? '').includes(s),
    );
  }

  return { items, ...pageMeta(page, limit, total) };
}

// ───────────────────────── reports ─────────────────────────

export async function getReports() {
  const [usersByRole, reservationsByStatus, revenueAgg, salonCount, stylistCount, discountCount, totalUsers] =
    await Promise.all([
      Promise.all(
        ROLES.map(async (role) => ({ role, count: await User.countDocuments({ roles: role }) })),
      ),
      Promise.all(
        RESERVATION_STATUSES.map(async (status) => ({
          status,
          count: await Reservation.countDocuments({ status }),
        })),
      ),
      Reservation.aggregate([
        { $match: { status: 'completed' } },
        { $group: { _id: null, gross: { $sum: { $ifNull: ['$price', 0] } } } },
      ]),
      Salon.countDocuments(),
      StylistProfile.countDocuments(),
      DiscountCode.countDocuments(),
      User.countDocuments(),
    ]);

  const totalReservations = reservationsByStatus.reduce((a, r) => a + r.count, 0);

  return {
    totals: {
      users: totalUsers,
      reservations: totalReservations,
      grossRevenue: revenueAgg[0]?.gross ?? 0,
      salons: salonCount,
      stylists: stylistCount,
      discountCodes: discountCount,
    },
    usersByRole,
    reservationsByStatus,
  };
}

// ───────────────────────── audit log ─────────────────────────

export async function listAuditLogs(query: PageQuery) {
  const { page, limit, skip } = paginate(query);
  const [rows, total] = await Promise.all([
    AuditLog.find().sort({ createdAt: -1 }).skip(skip).limit(limit).populate('adminId', 'phone').lean(),
    AuditLog.countDocuments(),
  ]);
  return {
    items: rows.map((r) => {
      const admin = r.adminId as unknown as { _id: Types.ObjectId; phone: string } | null;
      return {
        id: String(r._id),
        admin: admin ? { id: String(admin._id), phone: admin.phone } : null,
        action: r.action,
        targetType: r.targetType,
        targetId: r.targetId,
        summary: r.summary ?? null,
        createdAt: r.createdAt,
      };
    }),
    ...pageMeta(page, limit, total),
  };
}

// ───────────────────────── promotion (now audited) ─────────────────────────

function summarizePromotion(stylistId: string, p: {
  isPromoted: boolean;
  promotedUntil: Date | null;
  promotionTier?: number | null;
}) {
  return {
    stylistId,
    isPromoted: p.isPromoted,
    promotedUntil: p.promotedUntil,
    promotionTier: p.promotionTier ?? null,
  };
}

export async function promoteStylist(adminId: string, stylistId: string, until: Date, tier?: number) {
  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (!profile) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  profile.isPromoted = true;
  profile.promotedUntil = until;
  profile.promotionTier = tier ?? null;
  await profile.save();
  await audit(adminId, 'stylist.promote', 'stylist', stylistId, { until, tier: tier ?? null });
  return summarizePromotion(stylistId, profile);
}

export async function unpromoteStylist(adminId: string, stylistId: string) {
  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (!profile) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  profile.isPromoted = false;
  profile.promotedUntil = null;
  profile.promotionTier = null;
  await profile.save();
  await audit(adminId, 'stylist.unpromote', 'stylist', stylistId, {});
  return summarizePromotion(stylistId, profile);
}

// ───────────────────────── verification (blue tick) ─────────────────────────

export async function listVerifications(
  filter: { status?: 'pending' | 'verified' | 'rejected' | 'incomplete' } & PageQuery,
) {
  const { page, limit, skip } = paginate(filter);
  const status = filter.status ?? 'pending';
  const q = { verificationStatus: status };

  const [profiles, total] = await Promise.all([
    StylistProfile.find(q).sort({ profileSubmittedAt: -1 }).skip(skip).limit(limit).lean(),
    StylistProfile.countDocuments(q),
  ]);
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
    .select('firstName lastName phone nationalCode profilePhoto')
    .lean();
  const userById = new Map(users.map((u) => [String(u._id), u]));

  return {
    items: profiles.map((p) => {
      const u = userById.get(String(p.userId));
      return {
        id: String(p.userId),
        fullName: fullName(u) ?? 'متخصص',
        phone: u?.phone ?? null,
        nationalCode: u?.nationalCode ?? null, // admin-only
        profilePhoto: u?.profilePhoto ? storageProvider.getUrl(u.profilePhoto) : null,
        portfolio: (p.portfolio ?? []).map((k) => storageProvider.getUrl(k)),
        // Presence flags only — ID images are streamed via the protected
        // /admin/stylists/:id/documents/:side endpoint, never as a URL here.
        hasDocuments: { front: !!p.nationalCardFront, back: !!p.nationalCardBack },
        verificationStatus: p.verificationStatus,
        profileSubmittedAt: p.profileSubmittedAt,
      };
    }),
    ...pageMeta(page, limit, total),
  };
}

/**
 * Clear the national-ID references on the profile (caller persists with save).
 * Returns the storage keys that were referenced so the bytes can be purged.
 */
function clearNationalCardRefs(profile: IStylistProfile): string[] {
  const keys = [profile.nationalCardFront, profile.nationalCardBack].filter(Boolean) as string[];
  if (keys.length > 0) {
    profile.nationalCardFront = null;
    profile.nationalCardBack = null;
    profile.documentsDeletedAt = new Date();
  }
  return keys;
}

/** Best-effort deletion of national-ID bytes (references already cleared). */
async function purgeNationalCardBytes(keys: string[]): Promise<void> {
  for (const key of keys) await storageProvider.delete(key).catch(() => undefined);
}

export async function verifyStylist(adminId: string, stylistId: string) {
  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (!profile) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');

  // Privacy/retention: the sensitive national-ID images are only needed for the
  // verification decision — drop them now. Clearing the references is persisted
  // atomically with the verify; the bytes are then deleted best-effort.
  const cardKeys = clearNationalCardRefs(profile);
  profile.isVerified = true;
  profile.verificationStatus = 'verified';
  profile.verifiedAt = new Date();
  profile.verifiedBy = new Types.ObjectId(adminId);
  profile.rejectionReason = null;
  await profile.save();
  await purgeNationalCardBytes(cardKeys);
  await audit(adminId, 'stylist.verify', 'stylist', stylistId, {
    documentsDeleted: cardKeys.length > 0,
  });

  void (async () => {
    const u = await User.findById(stylistId).select('phone').lean();
    if (u?.phone) void notificationService.verificationApproved(u.phone);
  })();

  return { stylistId, isVerified: true, verificationStatus: profile.verificationStatus };
}

export async function rejectVerification(adminId: string, stylistId: string, reason?: string) {
  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (!profile) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');

  // Safe default: don't retain ID documents after a decision. On resubmit the
  // stylist re-uploads them; on eventual verify they'd be cleared anyway.
  const cardKeys = clearNationalCardRefs(profile);
  profile.isVerified = false;
  profile.verificationStatus = 'rejected';
  profile.rejectionReason = reason ?? null;
  profile.verifiedBy = new Types.ObjectId(adminId);
  await profile.save();
  await purgeNationalCardBytes(cardKeys);
  await audit(adminId, 'stylist.rejectVerification', 'stylist', stylistId, {
    reason: reason ?? null,
    documentsDeleted: cardKeys.length > 0,
  });

  void (async () => {
    const u = await User.findById(stylistId).select('phone').lean();
    if (u?.phone) void notificationService.verificationRejected(u.phone, { reason });
  })();

  return { stylistId, isVerified: false, verificationStatus: profile.verificationStatus };
}
