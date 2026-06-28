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
import {
  StylistProfile,
  IStylistProfile,
  PlanTier,
  planAllowsSmsCampaign,
} from '../../models/StylistProfile';
import { StylistSalon } from '../../models/StylistSalon';
import { StylistService } from '../../models/StylistService';
import { Salon, ServiceGender } from '../../models/Salon';
import { Service } from '../../models/Service';
import { ServiceCategory } from '../../models/ServiceCategory';
import { Promotion, IPromotion } from '../../models/Promotion';
import { Post } from '../../models/Post';
import { PostComment } from '../../models/PostComment';
import { ContentReport } from '../../models/ContentReport';
import { ProfileEditRequest } from '../../models/ProfileEditRequest';
import { Story } from '../../models/Story';
import { StoryView } from '../../models/StoryView';
import { updateSalon as updateSalonRecord } from '../salon/salon.service';
import { applyWalletChange } from '../wallet/wallet.service';
import { OpeningHoursInput } from '../../utils/openingHours';
import { nanoid } from 'nanoid';
import { Reservation, IReservation, ReservationStatus, RESERVATION_STATUSES } from '../../models/Reservation';
import { DiscountCode } from '../../models/DiscountCode';
import { WalletTransaction } from '../../models/WalletTransaction';
import { AuditLog } from '../../models/AuditLog';
import { SmsLog } from '../../models/SmsLog';
import { Review } from '../../models/Review';
import { recomputeStylistRating, VISIBLE_REVIEW_FILTER } from '../review/review.service';
import { createMessage } from '../message/message.service';
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

/**
 * Create an in-app message for a user IF the admin provided text. Used by the
 * moderation/delete actions: approval/rejection no longer sends SMS — the user
 * sees the status in-panel, plus this optional custom note. Best-effort.
 */
async function maybeSendMessage(
  adminId: string,
  recipientId: string,
  message: string | undefined,
  relatedType: string,
  title?: string,
): Promise<void> {
  const body = message?.trim();
  if (!body) return;
  try {
    await createMessage({ recipientId, body, title, relatedType, createdBy: adminId });
  } catch {
    /* messaging must not break the primary action */
  }
}

// ───────────────────────── users ─────────────────────────

export async function listUsers(filter: { role?: Role; search?: string } & PageQuery) {
  const { page, limit, skip } = paginate(filter);
  const q: Record<string, unknown> = {};
  if (filter.role) q.roles = filter.role;
  if (filter.search) {
    // Search by name, phone, national code, OR foreign id.
    const rx = new RegExp(escapeRegex(filter.search), 'i');
    q.$or = [
      { phone: rx },
      { firstName: rx },
      { lastName: rx },
      { nationalCode: rx },
      { foreignId: rx },
    ];
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

  const [profile, ownedSalons, memberships, services, reservationRows, walletTxRows] =
    await Promise.all([
      StylistProfile.findOne({ userId: id }).lean(),
      Salon.find({ ownerId: id }).select('name address status').lean(),
      StylistSalon.find({ stylistId: id }).populate('salonId', 'name status').lean(),
      StylistService.find({ stylistId: id }).populate('serviceId', 'name').lean(),
      // The user's reservations (as customer OR stylist), most recent first.
      Reservation.find({ $or: [{ customerId: id }, { stylistId: id }] })
        .sort({ startAt: -1 })
        .limit(20)
        .lean(),
      // Recent wallet ledger entries (for the admin wallet panel).
      WalletTransaction.find({ userId: id }).sort({ createdAt: -1 }).limit(10).lean(),
    ]);
  const reservations = await enrichReservations(reservationRows as unknown as IReservation[]);
  // Promotions (general + category) for the admin promotion-management panel.
  const promotions = profile ? await getStylistPromotions(id) : [];

  return {
    user: {
      id: String(user._id),
      phone: user.phone,
      roles: user.roles,
      isActive: user.isActive !== false,
      accountActive: accountStatus(user).active,
      inactiveReason: accountStatus(user).reason,
      suspendedReason: user.suspendedReason ?? null,
      socialBanned: user.socialBanned === true,
      socialBannedReason: user.socialBannedReason ?? null,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      nationalCode: user.nationalCode ?? null, // admin-only sensitive field
      birthDate: user.birthDate ?? null,
      isForeignNational: user.isForeignNational ?? false,
      foreignId: user.foreignId ?? null, // admin-only sensitive field
      foreignApprovalStatus: user.foreignApprovalStatus ?? 'not_required',
      foreignRejectionReason: user.foreignRejectionReason ?? null,
      profilePhoto: user.profilePhoto ? storageProvider.getUrl(user.profilePhoto) : null,
      walletBalance: user.walletBalance ?? 0,
      createdAt: user.createdAt,
    },
    // Recent wallet ledger (newest first) for the admin wallet panel.
    walletTransactions: walletTxRows.map((t) => ({
      id: String(t._id),
      type: t.type,
      amount: t.amount,
      reason: t.reason,
      status: t.status,
      createdAt: t.createdAt,
    })),
    // Portfolio with stable keys (the key IS the delete id).
    portfolio: (profile?.portfolio ?? []).map((key) => ({
      id: key,
      url: storageProvider.getUrl(key),
    })),
    reservations,
    stylistProfile: profile
      ? {
          status: profile.status,
          onboardingStep: profile.onboardingStep,
          isAcceptingReservations: profile.isAcceptingReservations !== false,
          ratingAverage: profile.ratingAverage,
          ratingCount: profile.ratingCount,
          isPromoted: profile.isPromoted,
          promotedUntil: profile.promotedUntil,
          smsCampaignEnabled: profile.smsCampaignEnabled ?? false,
          planTier: profile.planTier ?? 'free',
          promotions,
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

export async function setUserStatus(
  adminId: string,
  id: string,
  isActive: boolean,
  reason?: string,
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  if (id === adminId) {
    throw AppError.badRequest('نمی‌توانید حساب خودتان را غیرفعال کنید', 'CANNOT_DISABLE_SELF');
  }
  const user = await User.findById(id);
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');

  user.isActive = isActive;
  // Keep the suspension reason while suspended; clear it on re-activation.
  user.suspendedReason = isActive ? null : reason ?? null;
  await user.save();
  await audit(adminId, 'user.setStatus', 'user', id, { isActive, reason: reason ?? null });
  return { id, isActive, suspendedReason: user.suspendedReason };
}

// ──────────────── messages + image moderation ────────────────

/** Admin sends a standalone in-app message to a user. */
export async function sendMessageToUser(
  adminId: string,
  input: { recipientId: string; title?: string; body: string; relatedType?: string },
) {
  if (!Types.ObjectId.isValid(input.recipientId)) {
    throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  }
  const user = await User.findById(input.recipientId).select('_id').lean();
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');

  const message = await createMessage({
    recipientId: input.recipientId,
    body: input.body,
    title: input.title,
    relatedType: input.relatedType ?? 'admin_message',
    createdBy: adminId,
  });
  await audit(adminId, 'message.send', 'user', input.recipientId, {
    relatedType: input.relatedType ?? 'admin_message',
  });
  return { id: String(message._id) };
}

/** Admin removes a user's profile photo (any role). Optional message to the user. */
export async function deleteUserProfilePhoto(adminId: string, id: string, message?: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const user = await User.findById(id);
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');
  if (!user.profilePhoto) throw AppError.badRequest('این کاربر عکس پروفایل ندارد', 'NO_PROFILE_PHOTO');

  const key = user.profilePhoto;
  user.profilePhoto = undefined;
  await user.save();
  await storageProvider.delete(key);
  await audit(adminId, 'user.deleteProfilePhoto', 'user', id);
  await maybeSendMessage(adminId, id, message, 'image_removed', 'عکس پروفایل');
  return { id, profilePhoto: null };
}

/** Admin removes a single portfolio image of a stylist. Optional message. */
export async function deleteUserPortfolioItem(
  adminId: string,
  id: string,
  imageId: string,
  message?: string,
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const profile = await StylistProfile.findOne({ userId: id });
  if (!profile) throw AppError.notFound('پروفایل متخصص یافت نشد', 'STYLIST_PROFILE_NOT_FOUND');

  const idx = profile.portfolio.indexOf(imageId);
  if (idx === -1) throw AppError.notFound('نمونه‌کار یافت نشد', 'PORTFOLIO_ITEM_NOT_FOUND');

  profile.portfolio.splice(idx, 1);
  await profile.save();
  await storageProvider.delete(imageId);
  await audit(adminId, 'user.deletePortfolioItem', 'user', id, { imageId });
  await maybeSendMessage(adminId, id, message, 'image_removed', 'نمونه‌کار');
  return { id, portfolio: profile.portfolio.map((p) => storageProvider.getUrl(p)) };
}

// ─────────────────── foreign-national approvals ───────────────────

/** List foreign-national users by approval status (default: pending; 'all' = any). */
export async function listForeignApprovals(
  filter: { status?: 'pending' | 'approved' | 'rejected' | 'all' } & PageQuery,
) {
  const { page, limit, skip } = paginate(filter);
  const status = filter.status ?? 'pending';
  // 'all' lists every foreign user (so the admin can revisit a past decision).
  const q: Record<string, unknown> = { isForeignNational: true };
  if (status !== 'all') q.foreignApprovalStatus = status;

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

export async function approveForeign(adminId: string, id: string, message?: string) {
  const user = await loadForeignUser(id);
  user.foreignApprovalStatus = 'approved';
  user.foreignRejectionReason = null;
  await user.save();
  await audit(adminId, 'foreignNational.approve', 'user', id);
  // No SMS — status shows in-panel; optional in-app message.
  await maybeSendMessage(adminId, id, message, 'foreign_approved', 'تأیید حساب');
  return { id, foreignApprovalStatus: user.foreignApprovalStatus };
}

export async function rejectForeign(adminId: string, id: string, reason?: string, message?: string) {
  const user = await loadForeignUser(id);
  user.foreignApprovalStatus = 'rejected';
  user.foreignRejectionReason = reason ?? null;
  await user.save();
  await audit(adminId, 'foreignNational.reject', 'user', id, { reason: reason ?? null });
  await maybeSendMessage(adminId, id, message, 'foreign_rejected', 'تأیید حساب');
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

// ───────────────────────── sms delivery log ─────────────────────────

export async function listSmsLogs(
  filter: { event?: string; success?: 'true' | 'false' } & PageQuery,
) {
  const { page, limit, skip } = paginate(filter);
  const q: Record<string, unknown> = {};
  if (filter.event) q.event = filter.event;
  if (filter.success === 'true') q.success = true;
  if (filter.success === 'false') q.success = false;

  const [rows, total] = await Promise.all([
    SmsLog.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    SmsLog.countDocuments(q),
  ]);
  return {
    items: rows.map((r) => ({
      id: String(r._id),
      recipientMasked: r.recipientMasked,
      event: r.event,
      provider: r.provider,
      success: r.success,
      messageId: r.messageId ?? null,
      error: r.error ?? null,
      createdAt: r.createdAt,
    })),
    ...pageMeta(page, limit, total),
  };
}

// ───────────────────────── review moderation ─────────────────────────

export async function listReviews(
  filter: { status?: 'pending' | 'approved' | 'rejected' | 'all' } & PageQuery,
) {
  const { page, limit, skip } = paginate(filter);
  const status = filter.status ?? 'pending';
  const q: Record<string, unknown> =
    status === 'all'
      ? {}
      : status === 'approved'
        ? VISIBLE_REVIEW_FILTER // approved + legacy (missing status)
        : { status };

  const [rows, total] = await Promise.all([
    Review.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Review.countDocuments(q),
  ]);

  const userIds = [
    ...new Set(rows.flatMap((r) => [String(r.customerId), String(r.stylistId)])),
  ];
  const users = await User.find({ _id: { $in: userIds } })
    .select('firstName lastName phone')
    .lean();
  const byId = new Map(users.map((u) => [String(u._id), u]));

  return {
    items: rows.map((r) => ({
      id: String(r._id),
      rating: r.rating,
      comment: r.comment ?? null,
      status: r.status ?? 'approved',
      rejectionReason: r.rejectionReason ?? null,
      createdAt: r.createdAt,
      author: { id: String(r.customerId), fullName: fullName(byId.get(String(r.customerId))) },
      stylist: { id: String(r.stylistId), fullName: fullName(byId.get(String(r.stylistId))) },
    })),
    ...pageMeta(page, limit, total),
  };
}

/** Set a review's moderation status (from ANY status) and recompute the rating. */
async function moderateReview(
  adminId: string,
  id: string,
  status: 'approved' | 'rejected',
  reason?: string,
  message?: string,
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const review = await Review.findById(id);
  if (!review) throw AppError.notFound('نظر یافت نشد', 'REVIEW_NOT_FOUND');

  review.status = status;
  review.rejectionReason = status === 'rejected' ? reason ?? null : null;
  review.moderatedBy = new Types.ObjectId(adminId);
  review.moderatedAt = new Date();
  await review.save();

  // Visible-set changed → recompute the stylist's aggregate rating.
  await recomputeStylistRating(review.stylistId);
  await audit(adminId, `review.${status === 'approved' ? 'approve' : 'reject'}`, 'review', id, {
    reason: reason ?? null,
  });

  // No SMS for review moderation — the author sees the status in-panel; an
  // optional admin note is delivered as an in-app message.
  await maybeSendMessage(
    adminId,
    String(review.customerId),
    message,
    `review_${status}`,
    'نظر شما',
  );

  return { id, status: review.status };
}

export function approveReview(adminId: string, id: string, message?: string) {
  return moderateReview(adminId, id, 'approved', undefined, message);
}

export function rejectReview(adminId: string, id: string, reason?: string, message?: string) {
  return moderateReview(adminId, id, 'rejected', reason, message);
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

// ───────────────────────── promotions (general + category) ───────────────────
// Source of truth is the `Promotion` collection: one row per (stylist, category),
// with categoryId=null for a general promotion. No billing yet → admin-managed.
// TODO(billing): a successful promotion purchase will create the same record.

function serializePromotion(p: {
  _id: unknown;
  stylistId: unknown;
  categoryId: unknown;
  promotedUntil: Date;
  createdAt?: Date;
}) {
  // `stylistId`/`categoryId` may be populated docs or raw ids.
  const stylist = p.stylistId as { _id?: unknown; firstName?: string; lastName?: string } | unknown;
  const cat = p.categoryId as { _id?: unknown; name?: string } | null;
  const stylistObj = stylist as { _id?: unknown; firstName?: string; lastName?: string };
  return {
    id: String(p._id),
    stylistId: String(stylistObj?._id ?? p.stylistId),
    stylistName:
      `${stylistObj?.firstName ?? ''} ${stylistObj?.lastName ?? ''}`.trim() || null,
    categoryId: cat && (cat as { _id?: unknown })._id ? String((cat as { _id: unknown })._id) : p.categoryId ? String(p.categoryId) : null,
    categoryName: cat && (cat as { name?: string }).name ? (cat as { name: string }).name : null,
    promotedUntil: p.promotedUntil,
    isActive: new Date(p.promotedUntil).getTime() > Date.now(),
  };
}

/** Add or extend a stylist's promotion (general when categoryId is null/omitted). */
export async function addStylistPromotion(
  adminId: string,
  stylistId: string,
  categoryId: string | null,
  until: Date,
) {
  if (!Types.ObjectId.isValid(stylistId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (!profile) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  if (categoryId) {
    if (!Types.ObjectId.isValid(categoryId)) throw AppError.badRequest('دسته‌بندی نامعتبر', 'INVALID_ID');
    const cat = await ServiceCategory.findById(categoryId).select('_id').lean();
    if (!cat) throw AppError.notFound('دسته‌بندی یافت نشد', 'CATEGORY_NOT_FOUND');
  }
  const promo = await Promotion.findOneAndUpdate(
    { stylistId, categoryId: categoryId ?? null },
    { $set: { promotedUntil: until, createdBy: new Types.ObjectId(adminId) } },
    { upsert: true, new: true, setDefaultsOnInsert: true },
  );
  // Mirror the general promotion onto the legacy profile flag (the user-detail
  // "پروموشن" row + any old reader still works).
  if (categoryId == null) {
    profile.isPromoted = true;
    profile.promotedUntil = until;
    await profile.save();
  }
  await audit(adminId, 'stylist.addPromotion', 'stylist', stylistId, {
    categoryId: categoryId ?? null,
    until,
  });
  return serializePromotion(promo as unknown as IPromotion);
}

/** Remove a single promotion (by id). Clears the legacy flag if it was general. */
export async function removeStylistPromotion(adminId: string, stylistId: string, promotionId: string) {
  if (!Types.ObjectId.isValid(promotionId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const promo = await Promotion.findOne({ _id: promotionId, stylistId });
  if (!promo) throw AppError.notFound('پروموشن یافت نشد', 'PROMOTION_NOT_FOUND');
  const wasGeneral = promo.categoryId == null;
  await promo.deleteOne();
  if (wasGeneral) {
    await StylistProfile.updateOne(
      { userId: stylistId },
      { $set: { isPromoted: false, promotedUntil: null, promotionTier: null } },
    );
  }
  await audit(adminId, 'stylist.removePromotion', 'stylist', stylistId, { promotionId });
  return { id: promotionId };
}

/** All promotions for one stylist (active + expired), newest expiry first. */
export async function getStylistPromotions(stylistId: string) {
  if (!Types.ObjectId.isValid(stylistId)) return [];
  const promos = await Promotion.find({ stylistId })
    .sort({ promotedUntil: -1 })
    .populate('categoryId', 'name')
    .lean();
  return promos.map((p) => serializePromotion(p as unknown as IPromotion));
}

/** Active promotions across all stylists (for the admin management list). */
export async function listActivePromotions() {
  const promos = await Promotion.find({ promotedUntil: { $gt: new Date() } })
    .sort({ promotedUntil: 1 })
    .populate('stylistId', 'firstName lastName')
    .populate('categoryId', 'name')
    .lean();
  return promos.map((p) => serializePromotion(p as unknown as IPromotion));
}

// ───────────────────────── social moderation ─────────────────────────────
/** Open/all abuse reports with a small preview of the reported content. */
export async function listSocialReports(filter: { status?: 'open' | 'reviewed' } & PageQuery) {
  const { skip, limit, page } = paginate(filter);
  const q = filter.status ? { status: filter.status } : {};
  const [rows, total] = await Promise.all([
    ContentReport.find(q)
      .sort({ createdAt: -1 })
      .skip(skip)
      .limit(limit)
      .populate('reporterId', 'firstName lastName phone')
      .lean(),
    ContentReport.countDocuments(q),
  ]);
  // Resolve a short preview + author for each reported target.
  const items = await Promise.all(
    rows.map(async (r) => {
      let preview: string | null = null;
      let authorId: string | null = null;
      let exists = true;
      if (r.targetType === 'post') {
        const post = await Post.findById(r.targetId).select('caption authorId status').lean();
        if (!post) exists = false;
        else {
          preview = (post.caption || '').slice(0, 120) || '(بدون متن)';
          authorId = String(post.authorId);
        }
      } else if (r.targetType === 'story') {
        const story = await Story.findById(r.targetId).select('caption authorId status').lean();
        if (!story) exists = false;
        else {
          preview = `استوری: ${(story.caption || '').slice(0, 100) || '(بدون متن)'}`;
          authorId = String(story.authorId);
        }
      } else {
        const c = await PostComment.findById(r.targetId).select('text authorId status').lean();
        if (!c) exists = false;
        else {
          preview = c.text.slice(0, 120);
          authorId = String(c.authorId);
        }
      }
      const reporter = r.reporterId as unknown as { _id: unknown; firstName?: string; lastName?: string } | null;
      return {
        id: String(r._id),
        targetType: r.targetType,
        targetId: String(r.targetId),
        reason: r.reason,
        status: r.status,
        createdAt: r.createdAt,
        reporterName: reporter ? `${reporter.firstName ?? ''} ${reporter.lastName ?? ''}`.trim() || null : null,
        preview,
        authorId,
        exists,
      };
    }),
  );
  return { items, page, limit, total };
}

/** Resolve a minimal author view (name + photo) for a set of user ids. */
async function socialAuthorMap(authorIds: string[]) {
  const users = await User.find({ _id: { $in: [...new Set(authorIds)] } })
    .select('firstName lastName profilePhoto')
    .lean();
  return new Map(
    users.map((u) => [
      String(u._id),
      {
        id: String(u._id),
        fullName: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'متخصص',
        profilePhoto: u.profilePhoto ? storageProvider.getUrl(u.profilePhoto) : null,
      },
    ]),
  );
}

/** Open-report counts grouped by post id (one aggregate). */
async function reportCountsByTarget(targetType: 'post' | 'comment' | 'story', ids: (unknown)[]) {
  if (ids.length === 0) return new Map<string, number>();
  const rows = await ContentReport.aggregate<{ _id: unknown; count: number }>([
    { $match: { targetType, targetId: { $in: ids } } },
    { $group: { _id: '$targetId', count: { $sum: 1 } } },
  ]);
  return new Map(rows.map((r) => [String(r._id), r.count]));
}

/** All posts (active + removed) for admin moderation, with author + counts. */
export async function listSocialPosts(filter: { status?: 'active' | 'removed' } & PageQuery) {
  const { skip, limit, page } = paginate(filter);
  const q = filter.status ? { status: filter.status } : {};
  const [posts, total] = await Promise.all([
    Post.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Post.countDocuments(q),
  ]);
  const [authors, reportCounts] = await Promise.all([
    socialAuthorMap(posts.map((p) => String(p.authorId))),
    reportCountsByTarget('post', posts.map((p) => p._id)),
  ]);
  const items = posts.map((p) => ({
    id: String(p._id),
    author: authors.get(String(p.authorId)) ?? { id: String(p.authorId), fullName: 'حذف‌شده', profilePhoto: null },
    caption: p.caption,
    type: p.type,
    thumbnail: (() => {
      const key = p.images[0] ?? p.beforeImage ?? null;
      return key ? storageProvider.getUrl(key) : null;
    })(),
    imageCount: p.type === 'before_after' ? 2 : p.images.length,
    likeCount: p.likeCount,
    commentCount: p.commentCount,
    reportCount: reportCounts.get(String(p._id)) ?? 0,
    status: p.status,
    createdAt: p.createdAt,
  }));
  return { items, page, limit, total };
}

/** Full post detail for admin: images, author, its comments and its reports. */
export async function getSocialPost(id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const post = await Post.findById(id).lean();
  if (!post) throw AppError.notFound('پست یافت نشد', 'POST_NOT_FOUND');

  const [comments, reports] = await Promise.all([
    PostComment.find({ postId: id }).sort({ createdAt: 1 }).limit(100).lean(),
    ContentReport.find({ targetType: 'post', targetId: id })
      .sort({ createdAt: -1 })
      .populate('reporterId', 'firstName lastName')
      .lean(),
  ]);
  const authorIds = [String(post.authorId), ...comments.map((c) => String(c.authorId))];
  const [authors, commentReportCounts] = await Promise.all([
    socialAuthorMap(authorIds),
    reportCountsByTarget('comment', comments.map((c) => c._id)),
  ]);

  return {
    id: String(post._id),
    author: authors.get(String(post.authorId)) ?? { id: String(post.authorId), fullName: 'حذف‌شده', profilePhoto: null },
    caption: post.caption,
    type: post.type,
    images: post.images.map((k) => storageProvider.getUrl(k)),
    beforeImage: post.beforeImage ? storageProvider.getUrl(post.beforeImage) : null,
    afterImage: post.afterImage ? storageProvider.getUrl(post.afterImage) : null,
    hashtags: post.hashtags,
    likeCount: post.likeCount,
    commentCount: post.commentCount,
    status: post.status,
    removedReason: post.removedReason ?? null,
    createdAt: post.createdAt,
    comments: comments.map((c) => ({
      id: String(c._id),
      author: authors.get(String(c.authorId)) ?? { id: String(c.authorId), fullName: 'حذف‌شده', profilePhoto: null },
      text: c.text,
      status: c.status,
      reportCount: commentReportCounts.get(String(c._id)) ?? 0,
      createdAt: c.createdAt,
    })),
    reports: reports.map((r) => {
      const reporter = r.reporterId as unknown as { firstName?: string; lastName?: string } | null;
      return {
        id: String(r._id),
        reason: r.reason,
        status: r.status,
        reporterName: reporter ? `${reporter.firstName ?? ''} ${reporter.lastName ?? ''}`.trim() || null : null,
        createdAt: r.createdAt,
      };
    }),
  };
}

/** Remove a post (soft: status='removed'; hides it everywhere). Audited. */
export async function removeSocialPost(adminId: string, postId: string, reason?: string) {
  if (!Types.ObjectId.isValid(postId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const post = await Post.findById(postId);
  if (!post) throw AppError.notFound('پست یافت نشد', 'POST_NOT_FOUND');
  post.status = 'removed';
  post.removedReason = reason ?? null;
  await post.save();
  await ContentReport.updateMany({ targetType: 'post', targetId: post._id }, { $set: { status: 'reviewed' } });
  await audit(adminId, 'social.removePost', 'post', postId, { reason: reason ?? null });
  return { id: postId };
}

/** Remove a comment (soft) and decrement its post's count. Audited. */
export async function removeSocialComment(adminId: string, commentId: string, reason?: string) {
  if (!Types.ObjectId.isValid(commentId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const comment = await PostComment.findById(commentId);
  if (!comment) throw AppError.notFound('کامنت یافت نشد', 'COMMENT_NOT_FOUND');
  if (comment.status !== 'removed') {
    comment.status = 'removed';
    comment.removedReason = reason ?? null;
    await comment.save();
    await Post.updateOne({ _id: comment.postId }, { $inc: { commentCount: -1 } });
  }
  await ContentReport.updateMany({ targetType: 'comment', targetId: comment._id }, { $set: { status: 'reviewed' } });
  await audit(adminId, 'social.removeComment', 'comment', commentId, { reason: reason ?? null });
  return { id: commentId };
}

/** Ban/unban a user from the social network + notify them by message. Audited. */
export async function setSocialBan(adminId: string, userId: string, banned: boolean, reason?: string) {
  if (!Types.ObjectId.isValid(userId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');
  user.socialBanned = banned;
  user.socialBannedReason = banned ? reason ?? null : null;
  await user.save();
  await createMessage({
    recipientId: userId,
    title: banned ? 'مسدودسازی شبکه‌ی اجتماعی' : 'رفع مسدودی شبکه‌ی اجتماعی',
    body: banned
      ? `دسترسی شما به شبکه‌ی اجتماعی شونه مسدود شد${reason ? `: ${reason}` : '.'}`
      : 'دسترسی شما به شبکه‌ی اجتماعی شونه دوباره فعال شد.',
    relatedType: 'social_ban',
    createdBy: adminId,
  }).catch(() => undefined);
  await audit(adminId, banned ? 'social.banUser' : 'social.unbanUser', 'user', userId, { reason: reason ?? null });
  return { userId, socialBanned: banned };
}

/** Active (non-expired) stories for admin review, with author + view/report counts. */
export async function listSocialStories(filter: { includeExpired?: boolean } & PageQuery) {
  const { skip, limit, page } = paginate(filter);
  const q = filter.includeExpired ? {} : { status: 'active', expiresAt: { $gt: new Date() } };
  const [stories, total] = await Promise.all([
    Story.find(q).sort({ createdAt: -1 }).skip(skip).limit(limit).lean(),
    Story.countDocuments(q),
  ]);
  const [authors, viewCounts, reportCounts] = await Promise.all([
    socialAuthorMap(stories.map((s) => String(s.authorId))),
    (async () => {
      if (stories.length === 0) return new Map<string, number>();
      const rows = await StoryView.aggregate<{ _id: unknown; count: number }>([
        { $match: { storyId: { $in: stories.map((s) => s._id) } } },
        { $group: { _id: '$storyId', count: { $sum: 1 } } },
      ]);
      return new Map(rows.map((r) => [String(r._id), r.count]));
    })(),
    reportCountsByTarget('story', stories.map((s) => s._id)),
  ]);
  const items = stories.map((s) => ({
    id: String(s._id),
    author: authors.get(String(s.authorId)) ?? { id: String(s.authorId), fullName: 'حذف‌شده', profilePhoto: null },
    image: storageProvider.getUrl(s.image),
    caption: s.caption,
    status: s.status,
    viewCount: viewCounts.get(String(s._id)) ?? 0,
    reportCount: reportCounts.get(String(s._id)) ?? 0,
    createdAt: s.createdAt,
    expiresAt: s.expiresAt,
  }));
  return { items, page, limit, total };
}

/** Remove a story (soft: status='removed'; hidden everywhere). Audited. */
export async function removeSocialStory(adminId: string, storyId: string, reason?: string) {
  if (!Types.ObjectId.isValid(storyId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const story = await Story.findById(storyId);
  if (!story) throw AppError.notFound('استوری یافت نشد', 'STORY_NOT_FOUND');
  story.status = 'removed';
  story.removedReason = reason ?? null;
  await story.save();
  await ContentReport.updateMany({ targetType: 'story', targetId: story._id }, { $set: { status: 'reviewed' } });
  await audit(adminId, 'social.removeStory', 'story', storyId, { reason: reason ?? null });
  return { id: storyId };
}

// ───────────────────────── profile name-edit review ─────────────────────────
/** Pending (or all) name-edit requests with the user's CURRENT name for comparison. */
export async function listProfileEdits(filter: { status?: 'pending' | 'approved' | 'rejected' } & PageQuery) {
  const { skip, limit, page } = paginate(filter);
  const q = filter.status ? { status: filter.status } : {};
  const [rows, total] = await Promise.all([
    ProfileEditRequest.find(q)
      .sort({ createdAt: 1 })
      .skip(skip)
      .limit(limit)
      .populate('userId', 'firstName lastName phone profilePhoto')
      .lean(),
    ProfileEditRequest.countDocuments(q),
  ]);
  const items = rows.map((r) => {
    const u = r.userId as unknown as {
      _id: unknown;
      firstName?: string;
      lastName?: string;
      phone?: string;
      profilePhoto?: string;
    } | null;
    return {
      id: String(r._id),
      userId: u?._id ? String(u._id) : String(r.userId),
      phone: u?.phone ?? null,
      profilePhoto: u?.profilePhoto ? storageProvider.getUrl(u.profilePhoto) : null,
      currentName: u ? `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || '—' : '—',
      requestedFirstName: r.firstName,
      requestedLastName: r.lastName,
      status: r.status,
      createdAt: r.createdAt,
    };
  });
  return { items, page, limit, total };
}

/** Approve a name edit → apply it to the user. Audited + notifies the user. */
export async function approveProfileEdit(adminId: string, requestId: string) {
  if (!Types.ObjectId.isValid(requestId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const req = await ProfileEditRequest.findById(requestId);
  if (!req) throw AppError.notFound('درخواست یافت نشد', 'REQUEST_NOT_FOUND');
  if (req.status !== 'pending') throw AppError.badRequest('این درخواست قبلاً بررسی شده است', 'ALREADY_REVIEWED');
  const user = await User.findById(req.userId);
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');

  user.firstName = req.firstName;
  user.lastName = req.lastName;
  await user.save();
  req.status = 'approved';
  req.reviewedBy = new Types.ObjectId(adminId);
  await req.save();

  await createMessage({
    recipientId: String(user._id),
    title: 'تأیید ویرایش پروفایل',
    body: `نام نمایشی شما به «${req.firstName} ${req.lastName}» تغییر کرد.`,
    relatedType: 'profile_edit',
    createdBy: adminId,
  }).catch(() => undefined);
  await audit(adminId, 'profile.approveNameEdit', 'user', String(user._id), {
    firstName: req.firstName,
    lastName: req.lastName,
  });
  return { id: requestId, status: 'approved' as const };
}

/** Reject a name edit (keeps the current name). Audited + notifies the user. */
export async function rejectProfileEdit(adminId: string, requestId: string, reason?: string) {
  if (!Types.ObjectId.isValid(requestId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const req = await ProfileEditRequest.findById(requestId);
  if (!req) throw AppError.notFound('درخواست یافت نشد', 'REQUEST_NOT_FOUND');
  if (req.status !== 'pending') throw AppError.badRequest('این درخواست قبلاً بررسی شده است', 'ALREADY_REVIEWED');
  req.status = 'rejected';
  req.rejectionReason = reason ?? null;
  req.reviewedBy = new Types.ObjectId(adminId);
  await req.save();

  await createMessage({
    recipientId: String(req.userId),
    title: 'رد ویرایش پروفایل',
    body: `درخواست تغییر نام شما رد شد${reason ? `: ${reason}` : '.'}`,
    relatedType: 'profile_edit',
    createdBy: adminId,
  }).catch(() => undefined);
  await audit(adminId, 'profile.rejectNameEdit', 'user', String(req.userId), { reason: reason ?? null });
  return { id: requestId, status: 'rejected' as const };
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

export async function verifyStylist(adminId: string, stylistId: string, message?: string) {
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
  // No SMS — verification status shows in-panel; optional in-app message.
  await maybeSendMessage(adminId, stylistId, message, 'verification_approved', 'تأیید پروفایل');

  return { stylistId, isVerified: true, verificationStatus: profile.verificationStatus };
}

export async function rejectVerification(
  adminId: string,
  stylistId: string,
  reason?: string,
  message?: string,
) {
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
  await maybeSendMessage(adminId, stylistId, message, 'verification_rejected', 'تأیید پروفایل');

  return { stylistId, isVerified: false, verificationStatus: profile.verificationStatus };
}

// ───────────────── service catalogue (categories + services) ─────────────────
// Admin management of the PUBLIC catalogue. Stylist-private custom services
// (isCustom) are never created/edited/deleted here. All writes are audited and
// guarded against orphaning data (a category with services / a service still
// offered by stylists cannot be deleted).

function slugify(input?: string): string {
  const base = (input ?? '')
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  // Persian names yield an empty ascii slug → fall back to a unique token.
  return base || `cat-${nanoid(8).toLowerCase()}`;
}

/** Full catalogue (categories + their public services) for admin management. */
export async function listCatalogue() {
  const [categories, services] = await Promise.all([
    ServiceCategory.find().sort({ order: 1, name: 1 }).lean(),
    Service.find({ isCustom: { $ne: true } }).sort({ name: 1 }).lean(),
  ]);
  const byCategory = new Map<string, typeof services>();
  for (const s of services) {
    const k = String(s.categoryId);
    if (!byCategory.has(k)) byCategory.set(k, []);
    byCategory.get(k)!.push(s);
  }
  return {
    categories: categories.map((c) => ({
      id: String(c._id),
      name: c.name,
      slug: c.slug,
      description: c.description ?? null,
      order: c.order,
      isDefault: c.isDefault,
      services: (byCategory.get(String(c._id)) ?? []).map((s) => ({
        id: String(s._id),
        name: s.name,
        durationMin: s.durationMin,
        defaultPrice: s.defaultPrice,
        description: s.description ?? null,
        isDefault: s.isDefault,
      })),
    })),
  };
}

export async function createCategory(
  adminId: string,
  data: { name: string; slug?: string; description?: string; order?: number },
) {
  const slug = slugify(data.slug || data.name);
  if (await ServiceCategory.exists({ slug })) {
    throw AppError.conflict('این اسلاگ قبلاً استفاده شده است', 'SLUG_TAKEN');
  }
  const cat = await ServiceCategory.create({
    name: data.name,
    slug,
    description: data.description,
    order: data.order ?? 0,
    isDefault: false,
  });
  await audit(adminId, 'category.create', 'category', String(cat._id), { name: data.name, slug });
  return { id: String(cat._id), name: cat.name, slug: cat.slug, order: cat.order };
}

export async function updateCategory(
  adminId: string,
  id: string,
  data: { name?: string; slug?: string; description?: string; order?: number },
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const cat = await ServiceCategory.findById(id);
  if (!cat) throw AppError.notFound('دسته‌بندی یافت نشد', 'CATEGORY_NOT_FOUND');

  if (data.slug !== undefined) {
    const slug = slugify(data.slug);
    if (slug !== cat.slug && (await ServiceCategory.exists({ slug }))) {
      throw AppError.conflict('این اسلاگ قبلاً استفاده شده است', 'SLUG_TAKEN');
    }
    cat.slug = slug;
  }
  if (data.name !== undefined) cat.name = data.name;
  if (data.description !== undefined) cat.description = data.description;
  if (data.order !== undefined) cat.order = data.order;
  await cat.save();
  await audit(adminId, 'category.update', 'category', id, data);
  return { id, name: cat.name, slug: cat.slug, description: cat.description ?? null, order: cat.order };
}

export async function deleteCategory(adminId: string, id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const cat = await ServiceCategory.findById(id);
  if (!cat) throw AppError.notFound('دسته‌بندی یافت نشد', 'CATEGORY_NOT_FOUND');
  // Never orphan services — require the category to be empty first.
  const serviceCount = await Service.countDocuments({ categoryId: id });
  if (serviceCount > 0) {
    throw AppError.badRequest(
      `این دسته‌بندی ${serviceCount} خدمت دارد؛ ابتدا خدمات را حذف یا جابه‌جا کنید`,
      'CATEGORY_NOT_EMPTY',
    );
  }
  await cat.deleteOne();
  await audit(adminId, 'category.delete', 'category', id, { name: cat.name, slug: cat.slug });
  return { id, deleted: true };
}

export async function createService(
  adminId: string,
  data: {
    categoryId: string;
    name: string;
    durationMin: number;
    defaultPrice: number;
    description?: string;
  },
) {
  if (!Types.ObjectId.isValid(data.categoryId)) {
    throw AppError.badRequest('شناسه‌ی دسته‌بندی نامعتبر', 'INVALID_ID');
  }
  const cat = await ServiceCategory.findById(data.categoryId).select('_id').lean();
  if (!cat) throw AppError.notFound('دسته‌بندی یافت نشد', 'CATEGORY_NOT_FOUND');

  const svc = await Service.create({
    categoryId: new Types.ObjectId(data.categoryId),
    name: data.name,
    durationMin: data.durationMin,
    defaultPrice: data.defaultPrice,
    description: data.description,
    isDefault: false,
    isCustom: false,
    ownerStylistId: null,
  });
  await audit(adminId, 'service.create', 'service', String(svc._id), {
    name: data.name,
    categoryId: data.categoryId,
  });
  return { id: String(svc._id) };
}

/** Load a PUBLIC (non-custom) service for an admin write. */
async function loadPublicService(id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const svc = await Service.findById(id);
  if (!svc) throw AppError.notFound('خدمت یافت نشد', 'SERVICE_NOT_FOUND');
  if (svc.isCustom) {
    throw AppError.badRequest('خدمات اختصاصی متخصص از این بخش قابل مدیریت نیستند', 'SERVICE_IS_CUSTOM');
  }
  return svc;
}

export async function updateService(
  adminId: string,
  id: string,
  data: {
    categoryId?: string;
    name?: string;
    durationMin?: number;
    defaultPrice?: number;
    description?: string;
  },
) {
  const svc = await loadPublicService(id);
  if (data.categoryId !== undefined) {
    if (!Types.ObjectId.isValid(data.categoryId)) {
      throw AppError.badRequest('شناسه‌ی دسته‌بندی نامعتبر', 'INVALID_ID');
    }
    const cat = await ServiceCategory.findById(data.categoryId).select('_id').lean();
    if (!cat) throw AppError.notFound('دسته‌بندی یافت نشد', 'CATEGORY_NOT_FOUND');
    svc.categoryId = new Types.ObjectId(data.categoryId);
  }
  if (data.name !== undefined) svc.name = data.name;
  if (data.durationMin !== undefined) svc.durationMin = data.durationMin;
  if (data.defaultPrice !== undefined) svc.defaultPrice = data.defaultPrice;
  if (data.description !== undefined) svc.description = data.description;
  await svc.save();
  await audit(adminId, 'service.update', 'service', id, data);
  return { id, name: svc.name, durationMin: svc.durationMin, defaultPrice: svc.defaultPrice };
}

export async function deleteService(adminId: string, id: string) {
  const svc = await loadPublicService(id);
  // Don't break active offerings — block deletion while any stylist offers it.
  // Past reservations are unaffected (they snapshot service name/price).
  const offered = await StylistService.countDocuments({ serviceId: id });
  if (offered > 0) {
    throw AppError.badRequest(
      `این خدمت توسط ${offered} متخصص ارائه می‌شود و قابل حذف نیست`,
      'SERVICE_IN_USE',
    );
  }
  await svc.deleteOne();
  await audit(adminId, 'service.delete', 'service', id, { name: svc.name });
  return { id, deleted: true };
}

// ───────────────────────── salon management (admin) ─────────────────────────

/** Full salon detail for the admin panel (owner + stylist count + memberships). */
export async function getSalonDetail(id: string) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const salon = await Salon.findById(id).lean();
  if (!salon) throw AppError.notFound('سالن یافت نشد', 'SALON_NOT_FOUND');

  const [owner, memberships] = await Promise.all([
    salon.ownerId ? User.findById(salon.ownerId).select('firstName lastName phone').lean() : null,
    StylistSalon.find({ salonId: id }).populate('stylistId', 'firstName lastName phone').lean(),
  ]);

  return {
    id: String(salon._id),
    name: salon.name,
    description: salon.description ?? null,
    address: salon.address ?? null,
    province: salon.province ?? null,
    city: salon.city ?? null,
    location: salon.location ?? null,
    status: salon.status,
    serviceGender: salon.serviceGender ?? null,
    openingHours: salon.openingHours,
    owner: owner
      ? { id: String(salon.ownerId), fullName: fullName(owner), phone: owner.phone }
      : null,
    stylists: memberships.map((m) => {
      const u = m.stylistId as unknown as {
        _id: Types.ObjectId;
        firstName?: string;
        lastName?: string;
        phone?: string;
      } | null;
      return {
        id: u ? String(u._id) : String(m.stylistId),
        fullName: fullName(u),
        phone: u?.phone ?? null,
        membershipStatus: m.status,
      };
    }),
    createdAt: salon.createdAt,
  };
}

/** Admin edits any salon (bypasses owner check). Reuses the shared updater
 * (opening-hours validation + reservation reconciliation), then audits. */
export async function adminUpdateSalon(
  adminId: string,
  id: string,
  data: {
    name?: string;
    description?: string;
    address?: string;
    province?: string;
    city?: string;
    serviceGender?: ServiceGender;
    lng?: number;
    lat?: number;
    openingHours?: OpeningHoursInput[];
  },
) {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const salon = await updateSalonRecord(id, data);
  await audit(adminId, 'salon.update', 'salon', id, { fields: Object.keys(data) });
  return getSalonDetail(String(salon._id));
}

/** Admin sets a salon's status (active|pending). */
export async function setSalonStatus(adminId: string, id: string, status: 'active' | 'pending') {
  if (!Types.ObjectId.isValid(id)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const salon = await Salon.findById(id);
  if (!salon) throw AppError.notFound('سالن یافت نشد', 'SALON_NOT_FOUND');
  salon.status = status;
  await salon.save();
  await audit(adminId, 'salon.setStatus', 'salon', id, { status });
  return { id, status: salon.status };
}

// ───────────────────────── wallet (admin adjust) ─────────────────────────

/**
 * Manually credit/debit a user's wallet (support tool / pre-gateway testing).
 * `amount` is a signed integer Toman: positive credits, negative debits. The
 * change is applied atomically via the wallet service (balance ↔ ledger) and
 * audited; the optional note is stored on the transaction's meta.
 */
export async function adjustUserWallet(
  adminId: string,
  userId: string,
  amount: number,
  note?: string,
) {
  if (!Types.ObjectId.isValid(userId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const amt = Math.trunc(amount);
  if (!Number.isFinite(amt) || amt === 0) {
    throw AppError.badRequest('مبلغ نامعتبر است', 'INVALID_AMOUNT');
  }
  const user = await User.findById(userId).select('_id').lean();
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');

  const type: 'credit' | 'debit' = amt > 0 ? 'credit' : 'debit';
  const result = await applyWalletChange(userId, {
    type,
    amount: Math.abs(amt),
    reason: 'admin_adjust',
    meta: { adminId, ...(note ? { note } : {}) },
  });
  await audit(adminId, 'wallet.adjust', 'user', userId, {
    type,
    amount: Math.abs(amt),
    note: note ?? null,
  });
  return {
    userId,
    balance: result.balance,
    transaction: { id: String(result.transaction._id), type, amount: Math.abs(amt) },
  };
}

// ───────────────────── pending work counts (sidebar badges) ─────────────────────

/** One light query set powering the sidebar "pending work" badges. */
export async function getPendingCounts() {
  const [foreignApprovals, reviews, verifications, pendingSalons, socialReports, profileEdits] =
    await Promise.all([
      User.countDocuments({ isForeignNational: true, foreignApprovalStatus: 'pending' }),
      Review.countDocuments({ status: 'pending' }),
      StylistProfile.countDocuments({ verificationStatus: 'pending' }),
      Salon.countDocuments({ status: 'pending' }),
      ContentReport.countDocuments({ status: 'open' }),
      ProfileEditRequest.countDocuments({ status: 'pending' }),
    ]);
  return { foreignApprovals, reviews, verifications, pendingSalons, socialReports, profileEdits };
}

// ───────────────────────── reservation analytics ─────────────────────────

type Granularity = 'week' | 'month';

/**
 * Reservation time-series + revenue, bucketed by week or month (Iran days are
 * stored at their UTC midnight, so we truncate in UTC; the week starts Saturday).
 * Returns the series, range totals, period-over-period % change (last bucket vs
 * the previous one), the status breakdown, busiest weekday and top services.
 * A few small aggregations — Atlas-friendly.
 */
export async function getReservationAnalytics(opts: {
  granularity: Granularity;
  from?: string;
  to?: string;
}) {
  const granularity = opts.granularity;
  const to = opts.to ? new Date(`${opts.to}T00:00:00.000Z`) : new Date();
  let from: Date;
  if (opts.from) {
    from = new Date(`${opts.from}T00:00:00.000Z`);
  } else {
    from = new Date(to);
    // ~12 buckets by default.
    if (granularity === 'month') from.setUTCMonth(from.getUTCMonth() - 11);
    else from.setUTCDate(from.getUTCDate() - 7 * 11);
  }
  const match = { date: { $gte: from, $lte: to } };

  const truncSpec =
    granularity === 'week'
      ? { date: '$date', unit: 'week', binSize: 1, startOfWeek: 'saturday', timezone: 'UTC' }
      : { date: '$date', unit: 'month', binSize: 1, timezone: 'UTC' };

  const series = await Reservation.aggregate([
    { $match: match },
    {
      $group: {
        _id: { $dateTrunc: truncSpec },
        count: { $sum: 1 },
        revenue: {
          $sum: { $cond: [{ $eq: ['$status', 'completed'] }, { $ifNull: ['$price', 0] }, 0] },
        },
        completed: { $sum: { $cond: [{ $eq: ['$status', 'completed'] }, 1, 0] } },
        cancelled: { $sum: { $cond: [{ $eq: ['$status', 'cancelled'] }, 1, 0] } },
        confirmed: { $sum: { $cond: [{ $eq: ['$status', 'confirmed'] }, 1, 0] } },
      },
    },
    { $sort: { _id: 1 } },
  ]);

  const points = series.map((s) => ({
    bucket: (s._id as Date).toISOString().slice(0, 10),
    count: s.count as number,
    revenue: s.revenue as number,
    completed: s.completed as number,
    cancelled: s.cancelled as number,
    confirmed: s.confirmed as number,
  }));

  const last = points[points.length - 1];
  const prev = points[points.length - 2];
  const pct = (cur: number, prv: number) =>
    prv > 0 ? Math.round(((cur - prv) / prv) * 100) : cur > 0 ? 100 : 0;

  // Status breakdown across the whole range.
  const statusAgg = await Reservation.aggregate([
    { $match: match },
    { $group: { _id: '$status', count: { $sum: 1 } } },
  ]);
  const byStatus = RESERVATION_STATUSES.map((st) => ({
    status: st,
    count: (statusAgg.find((x) => x._id === st)?.count as number) ?? 0,
  }));

  // Busiest weekday. $dayOfWeek is 1..7 (1=Sunday) → JS 0..6 (0=Sunday).
  const dowAgg = await Reservation.aggregate([
    { $match: match },
    { $group: { _id: { $dayOfWeek: { date: '$date', timezone: 'UTC' } }, count: { $sum: 1 } } },
  ]);
  const byWeekday = Array.from({ length: 7 }, (_, i) => ({
    dayOfWeek: i,
    count: (dowAgg.find((x) => (x._id as number) - 1 === i)?.count as number) ?? 0,
  }));

  // Top services (by reservation count) — uses serviceIds, falling back to serviceId.
  const topAgg = await Reservation.aggregate([
    { $match: match },
    {
      $project: {
        ids: {
          $cond: [
            { $gt: [{ $size: { $ifNull: ['$serviceIds', []] } }, 0] },
            '$serviceIds',
            ['$serviceId'],
          ],
        },
      },
    },
    { $unwind: '$ids' },
    { $group: { _id: '$ids', count: { $sum: 1 } } },
    { $sort: { count: -1 } },
    { $limit: 6 },
  ]);
  const svcDocs = await Service.find({ _id: { $in: topAgg.map((t) => t._id) } })
    .select('name')
    .lean();
  const svcName = new Map(svcDocs.map((s) => [String(s._id), s.name]));
  const topServices = topAgg.map((t) => ({
    id: String(t._id),
    name: svcName.get(String(t._id)) ?? '—',
    count: t.count as number,
  }));

  return {
    granularity,
    from: from.toISOString().slice(0, 10),
    to: to.toISOString().slice(0, 10),
    points,
    totals: {
      reservations: points.reduce((a, p) => a + p.count, 0),
      revenue: points.reduce((a, p) => a + p.revenue, 0),
    },
    change: {
      reservations: last && prev ? pct(last.count, prev.count) : 0,
      revenue: last && prev ? pct(last.revenue, prev.revenue) : 0,
      current: { reservations: last?.count ?? 0, revenue: last?.revenue ?? 0 },
      previous: { reservations: prev?.count ?? 0, revenue: prev?.revenue ?? 0 },
    },
    byStatus,
    byWeekday,
    topServices,
  };
}

// ─────────────────── act-on-behalf (admin support actions) ───────────────────

/** Admin pauses/resumes a stylist's incoming bookings on their behalf. */
export async function setStylistAccepting(adminId: string, stylistId: string, accepting: boolean) {
  if (!Types.ObjectId.isValid(stylistId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (!profile) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  profile.isAcceptingReservations = accepting;
  await profile.save();
  await audit(adminId, 'stylist.setAccepting', 'stylist', stylistId, { accepting });
  return { stylistId, isAcceptingReservations: accepting };
}

/**
 * Admin enables/disables the paid SMS discount-campaign plan («نقره‌ای») for a
 * stylist. TODO(billing): once a payment gateway exists, a successful plan
 * purchase will set this flag instead of (or in addition to) the admin toggle.
 */
export async function setStylistSmsCampaign(adminId: string, stylistId: string, enabled: boolean) {
  if (!Types.ObjectId.isValid(stylistId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (!profile) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  profile.smsCampaignEnabled = enabled;
  await profile.save();
  await audit(adminId, 'stylist.setSmsCampaign', 'stylist', stylistId, { enabled });
  return { stylistId, smsCampaignEnabled: enabled };
}

/**
 * Admin sets a stylist's subscription plan tier (the source of truth for paid
 * features). `smsCampaignEnabled` is kept in sync (silver+ → true) so every
 * existing gate keeps working. No billing exists, so this is admin-only.
 */
export async function setStylistPlan(adminId: string, stylistId: string, tier: PlanTier) {
  if (!Types.ObjectId.isValid(stylistId)) throw AppError.badRequest('شناسه‌ی نامعتبر', 'INVALID_ID');
  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (!profile) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  profile.planTier = tier;
  profile.smsCampaignEnabled = planAllowsSmsCampaign(tier);
  await profile.save();
  await audit(adminId, 'stylist.setPlan', 'stylist', stylistId, { tier });
  return { stylistId, planTier: tier, smsCampaignEnabled: profile.smsCampaignEnabled };
}
