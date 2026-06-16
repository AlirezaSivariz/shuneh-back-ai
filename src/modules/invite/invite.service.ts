import { Types } from 'mongoose';
import { SalonInvite, ISalonInvite, SalonInviteStatus } from '../../models/SalonInvite';
import { Salon, IOpeningHours } from '../../models/Salon';
import { StylistSalon } from '../../models/StylistSalon';
import { User, IUser } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { toGeoPoint } from '../../utils/geo';
import { assertValidOpeningHours } from '../../utils/openingHours';
import { maskPhone } from '../../utils/phone';
import { smsProvider } from '../../utils/sms';
import { config } from '../../config/env';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days
const RESEND_COOLDOWN_MS = 5 * 60 * 1000; // 5 minutes between resends

const inviteUrlFor = (token: string) => `${config.webBaseUrl}/invite/${token}`;

/**
 * Lazily flip a pending-but-past-expiry invite to 'expired' (persisting it) so a
 * stylist can see WHY an invite went unanswered. Returns the effective status.
 */
async function expireIfNeeded(invite: ISalonInvite): Promise<SalonInviteStatus> {
  if (invite.status === 'pending' && invite.expiresAt.getTime() < Date.now()) {
    invite.status = 'expired';
    await invite.save();
  }
  return invite.status;
}

/**
 * Public lookup of an invite + its pending salon + the requesting stylist.
 * Rejects invites that are not usable (expired / already completed).
 */
export async function getInvite(token: string) {
  const invite = await SalonInvite.findOne({ token });
  if (!invite) throw AppError.notFound('دعوت یافت نشد', 'INVITE_NOT_FOUND');

  // Mark as expired on the fly if past its expiry.
  if (invite.status === 'pending' && invite.expiresAt.getTime() < Date.now()) {
    invite.status = 'expired';
    await invite.save();
  }

  if (invite.status !== 'pending') {
    throw AppError.badRequest(
      'این دعوت منقضی شده یا قبلاً استفاده شده است',
      'INVITE_NOT_AVAILABLE',
    );
  }

  const [salon, requester] = await Promise.all([
    Salon.findById(invite.salonId).lean(),
    User.findById(invite.requestedBy).select('firstName lastName phone').lean(),
  ]);

  return {
    token: invite.token,
    status: invite.status,
    // Masked for public display (the full number is never exposed here).
    targetPhone: maskPhone(invite.targetPhone),
    expiresAt: invite.expiresAt,
    salonDraft: invite.salonDraft ?? null,
    requestedBy: requester
      ? {
          id: String(requester._id),
          firstName: requester.firstName,
          lastName: requester.lastName,
          phone: requester.phone,
        }
      : null,
    salon: salon
      ? {
          id: String(salon._id),
          name: salon.name,
          description: salon.description,
          address: salon.address,
          location: salon.location,
          status: salon.status,
          openingHours: salon.openingHours,
        }
      : null,
  };
}

interface AcceptInput {
  name?: string;
  description?: string;
  address?: string;
  lng?: number;
  lat?: number;
  openingHours?: { dayOfWeek: number; intervals: { start: string; end: string }[] }[];
}

/**
 * The real owner claims the salon. The logged-in user must match the invite's
 * targetPhone. The 'owner' role is granted idempotently, then the salon is
 * confirmed/edited and activated and the invite is completed.
 */
export async function acceptInvite(userId: string, token: string, updates: AcceptInput) {
  const invite = await SalonInvite.findOne({ token });
  if (!invite) throw AppError.notFound('دعوت یافت نشد', 'INVITE_NOT_FOUND');

  if (invite.status === 'completed') {
    throw AppError.conflict('این دعوت قبلاً تکمیل شده است', 'INVITE_COMPLETED');
  }
  if (invite.status === 'expired' || invite.expiresAt.getTime() < Date.now()) {
    if (invite.status !== 'expired') {
      invite.status = 'expired';
      await invite.save();
    }
    throw AppError.badRequest('این دعوت منقضی شده است', 'INVITE_EXPIRED');
  }

  const owner: IUser | null = await User.findById(userId);
  if (!owner) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');

  // Security: only the phone the invite was issued to may claim it.
  if (owner.phone !== invite.targetPhone) {
    throw AppError.forbidden(
      'شماره‌ی شما با شماره‌ی دعوت‌شده مطابقت ندارد',
      'PHONE_MISMATCH',
    );
  }

  // Grant the owner role (idempotent).
  if (!owner.roles.includes('owner')) {
    owner.roles.push('owner');
    await owner.save();
  }

  const salon = await Salon.findById(invite.salonId);
  if (!salon) throw AppError.notFound('سالن یافت نشد', 'SALON_NOT_FOUND');

  // Apply the owner's edits (all optional — they may accept the draft as-is).
  if (updates.name !== undefined) salon.name = updates.name;
  if (updates.description !== undefined) salon.description = updates.description;
  if (updates.address !== undefined) salon.address = updates.address;
  if (updates.lng !== undefined && updates.lat !== undefined) {
    salon.location = toGeoPoint(updates.lng, updates.lat);
  }
  if (updates.openingHours !== undefined) {
    salon.openingHours = assertValidOpeningHours(updates.openingHours) as IOpeningHours[];
  }

  salon.ownerId = new Types.ObjectId(userId);
  salon.status = 'active';
  await salon.save();

  invite.status = 'completed';
  await invite.save();

  // NOTE: the requesting stylist's membership intentionally stays 'pending' — the
  // owner approves them through the normal salon-stylists flow after claiming.

  // Notify the stylist who created the invite that the owner accepted (non-blocking).
  const requester = await User.findById(invite.requestedBy).select('phone').lean();
  if (requester?.phone) {
    void smsProvider
      .send(requester.phone, `سالن «${salon.name}» توسط مالک در شونه تأیید شد.`)
      .catch(() => {});
  }

  return {
    salon: {
      id: String(salon._id),
      name: salon.name,
      status: salon.status,
      ownerId: String(salon.ownerId),
    },
    invite: { token: invite.token, status: invite.status },
    roles: owner.roles,
  };
}

/**
 * Invites a stylist has created, newest first, with effective status (expiring
 * stale ones on read) so they can track who hasn't responded. Scoped strictly to
 * the requesting stylist — an invite is only ever visible to its creator.
 */
export async function listStylistInvites(stylistId: string) {
  const invites = await SalonInvite.find({ requestedBy: stylistId }).sort({ createdAt: -1 });

  const salonIds = invites.map((i) => i.salonId);
  const salons = await Salon.find({ _id: { $in: salonIds } })
    .select('name status')
    .lean();
  const salonById = new Map(salons.map((s) => [String(s._id), s]));

  const result = [];
  for (const invite of invites) {
    const status = await expireIfNeeded(invite);
    const salon = salonById.get(String(invite.salonId));
    result.push({
      id: String(invite._id),
      status,
      // Masked — the full owner number is never exposed back to the stylist.
      targetPhone: maskPhone(invite.targetPhone),
      salon: {
        id: String(invite.salonId),
        name: salon?.name ?? ((invite.salonDraft?.name as string) || 'سالن'),
        status: salon?.status ?? 'pending',
      },
      inviteUrl: inviteUrlFor(invite.token),
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
      canResend: status === 'pending' || status === 'expired',
      canCancel: status !== 'completed',
    });
  }
  return result;
}

/**
 * Pending owner-invites addressed to a user's phone — the key to making invites
 * discoverable by NUMBER, not just by opening the magic link. A user who logs in
 * directly (never clicked the link) still sees the invitation(s) waiting for them.
 * Only non-expired pending invites are returned; the phone match is the same
 * normalized 09xxxxxxxxx format used at signup.
 */
export async function getPendingInvitesForUser(userId: string) {
  const user = await User.findById(userId).select('phone').lean();
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');

  const invites = await SalonInvite.find({
    targetPhone: user.phone,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  }).sort({ createdAt: -1 });

  const salons = await Salon.find({ _id: { $in: invites.map((i) => i.salonId) } })
    .select('name')
    .lean();
  const requesters = await User.find({ _id: { $in: invites.map((i) => i.requestedBy) } })
    .select('firstName lastName')
    .lean();
  const salonById = new Map(salons.map((s) => [String(s._id), s]));
  const reqById = new Map(requesters.map((u) => [String(u._id), u]));

  return invites.map((invite) => {
    const requester = reqById.get(String(invite.requestedBy));
    return {
      id: String(invite._id),
      token: invite.token,
      salonName:
        salonById.get(String(invite.salonId))?.name ??
        ((invite.salonDraft?.name as string) || 'سالن'),
      requestedBy: requester
        ? { firstName: requester.firstName ?? null, lastName: requester.lastName ?? null }
        : null,
      createdAt: invite.createdAt,
      expiresAt: invite.expiresAt,
    };
  });
}

/** Whether the user (by phone) has any actionable pending owner-invite. */
export async function hasPendingInvitesForPhone(phone: string): Promise<boolean> {
  const count = await SalonInvite.countDocuments({
    targetPhone: phone,
    status: 'pending',
    expiresAt: { $gt: new Date() },
  });
  return count > 0;
}

/** Load an invite that MUST belong to the given stylist, or 404. */
async function ownInviteOrThrow(stylistId: string, inviteId: string) {
  const invite = await SalonInvite.findOne({ _id: inviteId, requestedBy: stylistId });
  if (!invite) throw AppError.notFound('دعوت یافت نشد', 'INVITE_NOT_FOUND');
  return invite;
}

/**
 * Re-send the invite SMS (and refresh its 7-day expiry so a re-sent link works).
 * Rate-limited to one send per RESEND_COOLDOWN_MS to prevent spamming the owner.
 */
export async function resendInvite(stylistId: string, inviteId: string) {
  const invite = await ownInviteOrThrow(stylistId, inviteId);

  if (invite.status === 'completed') {
    throw AppError.conflict('این دعوت قبلاً تکمیل شده است', 'INVITE_COMPLETED');
  }

  const last = invite.lastSentAt?.getTime() ?? 0;
  const sinceLast = Date.now() - last;
  if (sinceLast < RESEND_COOLDOWN_MS) {
    const retryAfterSec = Math.ceil((RESEND_COOLDOWN_MS - sinceLast) / 1000);
    throw new AppError(
      429,
      'به‌تازگی این دعوت ارسال شده؛ کمی بعد دوباره تلاش کن',
      'RESEND_COOLDOWN',
      { retryAfterSec },
    );
  }

  // Re-activate + extend a (possibly expired) invite and re-send.
  invite.status = 'pending';
  invite.expiresAt = new Date(Date.now() + INVITE_TTL_MS);
  invite.lastSentAt = new Date();
  await invite.save();

  const url = inviteUrlFor(invite.token);
  void smsProvider
    .send(
      invite.targetPhone,
      `یادآوری: از شما دعوت شده تا سالن خود را در شونه ثبت کنید. لینک دعوت: ${url}`,
    )
    .catch(() => {});

  return {
    id: String(invite._id),
    status: invite.status,
    expiresAt: invite.expiresAt,
    inviteUrl: url,
  };
}

/**
 * Cancel a not-yet-completed invite. Removes the invite, and — only if still
 * unclaimed — the pending salon and the stylist's pending membership for it, so
 * no orphan pending records linger. A completed invite can't be cancelled.
 */
export async function cancelInvite(stylistId: string, inviteId: string) {
  const invite = await ownInviteOrThrow(stylistId, inviteId);

  if (invite.status === 'completed') {
    throw AppError.conflict('دعوت تکمیل‌شده قابل لغو نیست', 'INVITE_COMPLETED');
  }

  const salonId = invite.salonId;
  await invite.deleteOne();

  // Drop the pending salon + membership only if the owner never claimed it.
  const salon = await Salon.findById(salonId).select('status ownerId');
  if (salon && salon.status === 'pending' && !salon.ownerId) {
    await StylistSalon.deleteOne({ stylistId, salonId, status: 'pending' });
    await salon.deleteOne();
  }

  return { id: inviteId, cancelled: true };
}
