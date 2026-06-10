import { nanoid } from 'nanoid';
import { Types } from 'mongoose';
import { Salon, ISalon, IOpeningHours } from '../../models/Salon';
import { StylistSalon, StylistSalonStatus } from '../../models/StylistSalon';
import { SalonInvite } from '../../models/SalonInvite';
import { User } from '../../models/User';
import { StylistService } from '../../models/StylistService';
import { WorkingHour } from '../../models/WorkingHour';
import { AppError } from '../../utils/AppError';
import { toGeoPoint } from '../../utils/geo';
import { assertValidOpeningHours, OpeningHoursInput } from '../../utils/openingHours';
import { smsProvider } from '../../utils/sms';
import { config } from '../../config/env';

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
): Promise<ISalon> {
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

  // Owner is also a stylist working here -> active membership.
  await StylistSalon.updateOne(
    { stylistId: userId, salonId: salon._id },
    { $setOnInsert: { status: 'active' } },
    { upsert: true },
  );

  return salon;
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

  const token = nanoid(32);
  const invite = await SalonInvite.create({
    token,
    targetPhone: data.targetPhone,
    requestedBy: new Types.ObjectId(userId),
    salonId: salon._id,
    salonDraft: draft,
    status: 'pending',
    expiresAt: new Date(Date.now() + INVITE_TTL_MS),
  });

  // Stylist's membership stays pending until the owner accepts & approves.
  await StylistSalon.updateOne(
    { stylistId: userId, salonId: salon._id },
    { $setOnInsert: { status: 'pending' } },
    { upsert: true },
  );

  const link = `${config.baseUrl}/invite/${token}`;
  await smsProvider.send(
    data.targetPhone,
    `You have been invited to register your salon. Open: ${link}`,
  );

  return { salon, invite, link };
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

/** Owner rejects a stylist's request (status -> rejected). */
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
  return link;
}
