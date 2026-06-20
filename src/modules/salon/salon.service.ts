import { nanoid } from 'nanoid';
import { Types } from 'mongoose';
import { Salon, ISalon, IOpeningHours } from '../../models/Salon';
import { StylistSalon, StylistSalonStatus } from '../../models/StylistSalon';
import { SalonInvite } from '../../models/SalonInvite';
import { User } from '../../models/User';
import { StylistProfile } from '../../models/StylistProfile';
import { StylistService } from '../../models/StylistService';
import { WorkingHour } from '../../models/WorkingHour';
import { Reservation } from '../../models/Reservation';
import { AppError } from '../../utils/AppError';
import { toGeoPoint } from '../../utils/geo';
import { storageProvider } from '../../utils/storage';
import { assertValidOpeningHours, OpeningHoursInput } from '../../utils/openingHours';
import { smsProvider } from '../../utils/sms';
import { notificationService } from '../../utils/notification';
import { config } from '../../config/env';
import { ensureStylistProfile } from '../onboarding/onboarding.service';
import { reconcileSalonHoursChange } from '../stylist/hoursReconcile';

const INVITE_TTL_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

const validateOpeningHours = (openingHours: OpeningHoursInput[]): IOpeningHours[] =>
  assertValidOpeningHours(openingHours) as IOpeningHours[];

/**
 * Geo + name search for salons. Any combination of filters is allowed.
 */
export async function searchSalons(params: {
  name?: string;
  lng?: number;
  lat?: number;
  radius?: number; // meters
}) {
  const query: Record<string, unknown> = {};

  if (params.name) {
    query.name = { $regex: params.name, $options: 'i' };
  }

  if (params.lng !== undefined && params.lat !== undefined) {
    query.location = {
      $near: {
        $geometry: toGeoPoint(params.lng, params.lat),
        $maxDistance: params.radius ?? 5000,
      },
    };
  }

  const salons = await Salon.find(query).limit(50).lean();
  return salons.map((s) => ({
    id: String(s._id),
    name: s.name,
    description: s.description,
    address: s.address,
    location: s.location,
    status: s.status,
    openingHours: s.openingHours,
  }));
}

/**
 * Create a salon owned by the creator (active), and link the creator stylist
 * to it with an active membership.
 */
export async function createOwnSalon(
  userId: string,
  data: {
    name: string;
    description?: string;
    address: string;
    lng: number;
    lat: number;
    openingHours: OpeningHoursInput[];
  },
): Promise<{ salon: ISalon; onboardingStep: string }> {
  const salon = await Salon.create({
    name: data.name,
    description: data.description,
    address: data.address,
    location: toGeoPoint(data.lng, data.lat),
    ownerId: new Types.ObjectId(userId),
    status: 'active',
    openingHours: validateOpeningHours(data.openingHours),
    createdBy: new Types.ObjectId(userId),
  });

  // The creator owns this salon AND works in it → grant the 'owner' role
  // (idempotent) so they get the full owner panel, and link them as an ACTIVE
  // member of their own salon (no self-approval needed).
  await User.updateOne({ _id: userId }, { $addToSet: { roles: 'owner' } });
  await StylistSalon.updateOne(
    { stylistId: userId, salonId: salon._id },
    { $setOnInsert: { status: 'active', requestedBy: 'stylist' } },
    { upsert: true },
  );

  // Record the workplace type but do NOT advance onboarding here — the stylist
  // may add several workplaces; the step is finalized via completeWorkplaceStep.
  const profile = await ensureStylistProfile(userId);
  profile.workplaceType = 'salon';
  await profile.save();

  return { salon, onboardingStep: profile.onboardingStep };
}

/**
 * Create a pending salon on behalf of its real owner and send them an invite.
 * The requesting stylist is linked with a pending membership and keeps going.
 */
export async function createSalonInvite(
  userId: string,
  data: { salonDraft: Record<string, unknown>; targetPhone: string },
) {
  const draft = data.salonDraft;
  const salon = await Salon.create({
    name: (draft.name as string) ?? 'Pending salon',
    description: draft.description as string | undefined,
    address: draft.address as string | undefined,
    location:
      typeof draft.lng === 'number' && typeof draft.lat === 'number'
        ? toGeoPoint(draft.lng as number, draft.lat as number)
        : undefined,
    ownerId: null,
    status: 'pending',
    openingHours: Array.isArray(draft.openingHours)
      ? validateOpeningHours(draft.openingHours as OpeningHoursInput[])
      : [],
    createdBy: new Types.ObjectId(userId),
  });

  // nanoid is a cryptographically-secure random generator (crypto.randomBytes
  // under the hood); 32 chars → unguessable token.
  const token = nanoid(32);
  const invite = await SalonInvite.create({
    token,
    targetPhone: data.targetPhone,
    requestedBy: new Types.ObjectId(userId),
    salonId: salon._id,
    salonDraft: draft,
    status: 'pending',
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
    lastSentAt: new Date(),
  });

  // Stylist's membership stays pending until the owner accepts & approves.
  await StylistSalon.updateOne(
    { stylistId: userId, salonId: salon._id },
    { $setOnInsert: { status: 'pending' } },
    { upsert: true },
  );

  // Record the workplace type but do NOT advance onboarding — the stylist may
  // add several invites/salons; the step is finalized via completeWorkplaceStep.
  const profile = await ensureStylistProfile(userId);
  profile.workplaceType = 'salon';
  await profile.save();

  // The invite link points to the FRONTEND page (/invite/:token), not the API.
  const inviteUrl = `${config.webBaseUrl}/invite/${token}`;
  // Non-blocking SMS to the salon owner (stub provider just logs).
  void smsProvider
    .send(
      data.targetPhone,
      `از شما دعوت شده تا سالن خود را در شونه ثبت کنید. لینک دعوت: ${inviteUrl}`,
    )
    .catch(() => {});

  return { salon, invite, inviteUrl, onboardingStep: profile.onboardingStep };
}

/**
 * Look up the salons owned by the holder of a given phone number — used during
 * the stylist's workplace flow so they can JOIN an owner's existing salon
 * (a pending membership the owner approves) instead of creating a duplicate
 * salon + invite. Privacy: only salon info is returned, never the owner's
 * identity/contact. `found` is true only when the phone maps to an owner that
 * actually has at least one salon.
 */
export async function findSalonsByOwnerPhone(phone: string) {
  const owner = await User.findOne({ phone }).select('_id roles').lean();
  if (!owner || !owner.roles.includes('owner')) {
    return { found: false, salons: [] as { id: string; name: string; address?: string; status: string }[] };
  }
  const salons = await Salon.find({ ownerId: owner._id }).sort({ createdAt: 1 }).lean();
  return {
    found: salons.length > 0,
    salons: salons.map((s) => ({
      id: String(s._id),
      name: s.name,
      address: s.address,
      status: s.status,
    })),
  };
}

/** Salons owned by a given owner. */
export async function listOwnerSalons(ownerId: string) {
  const salons = await Salon.find({ ownerId }).sort({ createdAt: 1 }).lean();
  return salons.map((s) => ({
    id: String(s._id),
    name: s.name,
    description: s.description,
    address: s.address,
    location: s.location,
    status: s.status,
    openingHours: s.openingHours,
  }));
}

/**
 * Stylist membership requests for a salon, optionally filtered by status,
 * enriched with the stylist's profile, offered services and the working hours
 * they proposed for THIS salon. Authorization (salon ownership) is enforced by
 * the requireSalonOwner middleware.
 */
export async function listSalonStylists(salonId: string, status?: StylistSalonStatus) {
  const filter: Record<string, unknown> = { salonId };
  if (status) filter.status = status;

  const links = await StylistSalon.find(filter).sort({ createdAt: 1 });
  const stylistIds = links.map((l) => l.stylistId);

  const [users, services, hours] = await Promise.all([
    User.find({ _id: { $in: stylistIds } })
      .select('firstName lastName phone profilePhoto')
      .lean(),
    StylistService.find({ stylistId: { $in: stylistIds } }).populate('serviceId').lean(),
    WorkingHour.find({ stylistId: { $in: stylistIds }, salonId }).lean(),
  ]);

  const userById = new Map(users.map((u) => [String(u._id), u]));

  return links.map((link) => {
    const sid = String(link.stylistId);
    const user = userById.get(sid);
    return {
      stylistId: sid,
      membershipStatus: link.status,
      // 'owner' → owner invited (stylist must accept); 'stylist' → owner approves.
      requestedBy: link.requestedBy,
      stylist: user
        ? {
            id: sid,
            firstName: user.firstName,
            lastName: user.lastName,
            phone: user.phone,
            profilePhoto: user.profilePhoto,
          }
        : null,
      services: services
        .filter((s) => String(s.stylistId) === sid)
        .map((s) => ({ id: String(s._id), service: s.serviceId, price: s.price, durationMin: s.durationMin })),
      workingHours: hours
        .filter((h) => String(h.stylistId) === sid)
        .map((h) => ({ id: String(h._id), dayOfWeek: h.dayOfWeek, start: h.start, end: h.end })),
    };
  });
}

/**
 * Owner approves a stylist's request to join their salon (status -> active).
 * Ownership is verified by middleware; here we only validate the membership.
 */
export async function approveStylist(salonId: string, stylistId: string) {
  const link = await StylistSalon.findOne({ salonId, stylistId });
  if (!link) {
    throw AppError.notFound(
      'این متخصص درخواستی برای این سالن ثبت نکرده است',
      'LINK_NOT_FOUND',
    );
  }
  if (link.status === 'active') {
    throw AppError.conflict('این متخصص قبلاً تأیید شده است', 'ALREADY_ACTIVE');
  }

  link.status = 'active';
  await link.save();
  return link;
}

/**
 * Owner rejects a stylist's request (status -> rejected).
 * Returns the membership plus a count of the stylist's FUTURE active
 * reservations at this salon, as a warning (auto-cancellation is NOT performed
 * here — that is intentionally left for a later decision).
 */
export async function rejectStylist(salonId: string, stylistId: string) {
  const link = await StylistSalon.findOne({ salonId, stylistId });
  if (!link) {
    throw AppError.notFound(
      'این متخصص درخواستی برای این سالن ثبت نکرده است',
      'LINK_NOT_FOUND',
    );
  }

  link.status = 'rejected';
  await link.save();

  // Notify the stylist (best-effort; never fails the reject).
  const [stylist, salon] = await Promise.all([
    User.findById(stylistId).select('phone').lean(),
    Salon.findById(salonId).select('name').lean(),
  ]);
  if (stylist?.phone) {
    void notificationService
      .salonMembershipRejected(stylist.phone, { salonName: salon?.name })
      .catch(() => undefined);
  }

  // Warn about upcoming reservations affected (not cancelled automatically).
  const affectedUpcomingReservations = await Reservation.countDocuments({
    salonId,
    stylistId,
    status: { $in: ['pending', 'confirmed'] },
    startAt: { $gte: new Date() },
  });

  return { link, affectedUpcomingReservations };
}

/**
 * Owner invites a stylist to work in their salon (reverse of the join flow).
 * Creates a StylistSalon with status='pending' and requestedBy='owner' — now the
 * STYLIST must accept. Ownership of `salon` is pre-verified by requireSalonOwner.
 */
export async function inviteStylistToSalon(salon: ISalon, stylistId: string) {
  if (salon.status !== 'active') {
    throw AppError.badRequest('فقط برای سالن فعال می‌توان متخصص دعوت کرد', 'SALON_NOT_ACTIVE');
  }
  if (String(salon.ownerId) === stylistId) {
    throw AppError.badRequest('شما خودتان مالک این سالن هستید', 'OWNER_IS_STYLIST');
  }

  const [target, profile] = await Promise.all([
    User.findById(stylistId).select('phone roles').lean(),
    StylistProfile.findOne({ userId: stylistId }).select('_id').lean(),
  ]);
  if (!target || !profile || !target.roles.includes('stylist')) {
    throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');
  }

  const existing = await StylistSalon.findOne({ stylistId, salonId: salon._id });
  if (existing) {
    if (existing.status === 'active') {
      throw AppError.conflict('این متخصص از قبل عضو فعال سالن است', 'ALREADY_ACTIVE');
    }
    if (existing.status === 'pending') {
      throw AppError.conflict('برای این متخصص یک درخواست در انتظار وجود دارد', 'ALREADY_PENDING');
    }
    // Was rejected before → re-invite (owner-initiated, pending again).
    existing.status = 'pending';
    existing.requestedBy = 'owner';
    await existing.save();
  } else {
    await StylistSalon.create({
      stylistId: new Types.ObjectId(stylistId),
      salonId: salon._id,
      status: 'pending',
      requestedBy: 'owner',
    });
  }

  if (target.phone) {
    void notificationService
      .salonInviteFromOwner(target.phone, { salonName: salon.name })
      .catch(() => undefined);
  }

  return { stylistId, salonId: String(salon._id), status: 'pending' as const };
}

/** Active stylists matched by name — for an owner picking who to invite. */
export async function searchStylistsForInvite(q: string) {
  const profiles = await StylistProfile.find({ status: 'active' }).select('userId').lean();
  const users = await User.find({ _id: { $in: profiles.map((p) => p.userId) } })
    .select('firstName lastName profilePhoto')
    .lean();
  const term = q.toLowerCase();
  return users
    .filter((u) => `${u.firstName ?? ''} ${u.lastName ?? ''}`.toLowerCase().includes(term))
    .slice(0, 20)
    .map((u) => ({
      id: String(u._id),
      fullName: `${u.firstName ?? ''} ${u.lastName ?? ''}`.trim() || 'متخصص',
      profilePhoto: u.profilePhoto ? storageProvider.getUrl(u.profilePhoto) : null,
    }));
}

/**
 * Collaboration requests an OWNER sent to a stylist (requestedBy='owner'), which
 * the stylist must accept/reject. Scoped strictly to the requesting stylist.
 */
export async function listStylistSalonRequests(stylistId: string, status?: StylistSalonStatus) {
  const filter: Record<string, unknown> = { stylistId, requestedBy: 'owner' };
  if (status) filter.status = status;

  const links = await StylistSalon.find(filter)
    .populate<{ salonId: ISalon }>('salonId')
    .sort({ createdAt: -1 });

  const ownerIds = links
    .map((l) => (l.salonId as unknown as ISalon | null)?.ownerId)
    .filter(Boolean) as Types.ObjectId[];
  const owners = await User.find({ _id: { $in: ownerIds } })
    .select('firstName lastName')
    .lean();
  const ownerById = new Map(owners.map((o) => [String(o._id), o]));

  return links.map((link) => {
    const salon = link.salonId as unknown as ISalon | null;
    const owner = salon?.ownerId ? ownerById.get(String(salon.ownerId)) : null;
    return {
      id: String(link._id),
      status: link.status,
      salon: salon
        ? { id: String(salon._id), name: salon.name, address: salon.address ?? null }
        : null,
      owner: owner
        ? { firstName: owner.firstName ?? null, lastName: owner.lastName ?? null }
        : null,
      createdAt: link.createdAt,
    };
  });
}

/** Stylist accepts/rejects an owner's collaboration request (their own only). */
export async function respondToSalonRequest(
  stylistId: string,
  requestId: string,
  decision: 'accept' | 'reject',
) {
  const link = await StylistSalon.findOne({
    _id: requestId,
    stylistId,
    requestedBy: 'owner',
  });
  if (!link) throw AppError.notFound('درخواست یافت نشد', 'REQUEST_NOT_FOUND');
  if (link.status !== 'pending') {
    throw AppError.badRequest('این درخواست قبلاً پاسخ داده شده است', 'REQUEST_NOT_PENDING');
  }

  link.status = decision === 'accept' ? 'active' : 'rejected';
  await link.save();
  return { id: String(link._id), status: link.status };
}

/**
 * Owner edits one of their salons (name / description / address / location /
 * opening hours). Same opening-hours validation as creation.
 */
export async function updateSalon(
  salonId: string,
  data: {
    name?: string;
    description?: string;
    address?: string;
    lng?: number;
    lat?: number;
    openingHours?: OpeningHoursInput[];
  },
): Promise<ISalon> {
  const salon = await Salon.findById(salonId);
  if (!salon) throw AppError.notFound('سالن یافت نشد', 'SALON_NOT_FOUND');

  if (data.name !== undefined) salon.name = data.name;
  if (data.description !== undefined) salon.description = data.description;
  if (data.address !== undefined) salon.address = data.address;
  if (data.lng !== undefined && data.lat !== undefined) {
    salon.location = toGeoPoint(data.lng, data.lat);
  }
  const openingHoursChanged = data.openingHours !== undefined;
  if (data.openingHours !== undefined) {
    salon.openingHours = validateOpeningHours(data.openingHours);
  }

  await salon.save();

  // Changing opening hours can push existing future reservations of the salon's
  // stylists outside their (now-clipped) working hours. Never auto-cancel — flag
  // & warn the affected stylists so they reconcile.
  if (openingHoursChanged) {
    await reconcileSalonHoursChange(salonId);
  }

  return salon;
}
