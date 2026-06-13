import { Types } from 'mongoose';
import { SalonInvite } from '../../models/SalonInvite';
import { Salon, IOpeningHours } from '../../models/Salon';
import { User, IUser } from '../../models/User';
import { AppError } from '../../utils/AppError';
import { toGeoPoint } from '../../utils/geo';
import { assertValidOpeningHours } from '../../utils/openingHours';
import { maskPhone } from '../../utils/phone';

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
