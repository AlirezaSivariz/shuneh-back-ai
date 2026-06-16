/**
 * Single source of truth for "is this stylist bookable?".
 *
 * A stylist is bookable only when they have at least one ACTIVE workplace —
 * freelance with a set location, OR an active membership (StylistSalon.status =
 * 'active') in an active salon (Salon.status = 'active') — AND they are accepting
 * reservations. Rejected/left/pending memberships and pending salons do NOT
 * count. Centralizing this here removes the scattered, drifting checks that let
 * a rejected-but-still-"active"-profile stylist stay bookable.
 */
import { StylistSalon } from '../../models/StylistSalon';
import { Salon } from '../../models/Salon';

export type BookabilityReason = 'no_active_workplace' | 'pending_salons' | 'not_accepting';

export interface Bookability {
  bookable: boolean;
  reason: BookabilityReason | null;
  /** True when the stylist is a freelancer with a set location. */
  freelance: boolean;
  /** Salon ids where the stylist is an active member of an active salon. */
  activeSalonIds: string[];
}

export interface BookabilityProfile {
  workplaceType?: string | null;
  freelance?: { location?: unknown } | null;
  isAcceptingReservations?: boolean;
}

/** Pure decision given a profile + its resolved active-salon set. */
export function decideBookability(
  profile: BookabilityProfile,
  activeSalonIds: string[],
  hasPendingMembership: boolean,
): Bookability {
  const freelance = profile.workplaceType === 'freelance' && !!profile.freelance?.location;
  const hasActiveWorkplace = freelance || activeSalonIds.length > 0;

  if (!hasActiveWorkplace) {
    return {
      bookable: false,
      reason: hasPendingMembership ? 'pending_salons' : 'no_active_workplace',
      freelance,
      activeSalonIds,
    };
  }
  if (profile.isAcceptingReservations === false) {
    return { bookable: false, reason: 'not_accepting', freelance, activeSalonIds };
  }
  return { bookable: true, reason: null, freelance, activeSalonIds };
}

/** Resolve a single stylist's active-salon ids (+ whether any membership is pending). */
export async function resolveActiveSalons(
  stylistId: string,
): Promise<{ activeSalonIds: string[]; hasPendingMembership: boolean }> {
  const links = await StylistSalon.find({ stylistId }).select('salonId status').lean();
  const hasPendingMembership = links.some((l) => l.status === 'pending');
  const activeLinkSalonIds = links
    .filter((l) => l.status === 'active')
    .map((l) => String(l.salonId));
  if (activeLinkSalonIds.length === 0) return { activeSalonIds: [], hasPendingMembership };

  const activeSalons = await Salon.find({ _id: { $in: activeLinkSalonIds }, status: 'active' })
    .select('_id')
    .lean();
  return { activeSalonIds: activeSalons.map((s) => String(s._id)), hasPendingMembership };
}

/** Bookability for one stylist. */
export async function getBookability(
  stylistId: string,
  profile: BookabilityProfile,
): Promise<Bookability> {
  const { activeSalonIds, hasPendingMembership } = await resolveActiveSalons(stylistId);
  return decideBookability(profile, activeSalonIds, hasPendingMembership);
}

/** Bulk bookability for many stylists — one query set (for search/featured). */
export async function getBookabilityMap(
  profiles: (BookabilityProfile & { userId: unknown })[],
): Promise<Map<string, Bookability>> {
  const ids = profiles.map((p) => String(p.userId));
  const links = await StylistSalon.find({ stylistId: { $in: ids } })
    .select('stylistId salonId status')
    .lean();

  const activeLinkSalonIds = [
    ...new Set(links.filter((l) => l.status === 'active').map((l) => String(l.salonId))),
  ];
  const activeSalons = await Salon.find({ _id: { $in: activeLinkSalonIds }, status: 'active' })
    .select('_id')
    .lean();
  const activeSalonSet = new Set(activeSalons.map((s) => String(s._id)));

  const perStylist = new Map<string, { active: string[]; pending: boolean }>();
  for (const id of ids) perStylist.set(id, { active: [], pending: false });
  for (const l of links) {
    const entry = perStylist.get(String(l.stylistId));
    if (!entry) continue;
    if (l.status === 'active' && activeSalonSet.has(String(l.salonId))) {
      entry.active.push(String(l.salonId));
    }
    if (l.status === 'pending') entry.pending = true;
  }

  const map = new Map<string, Bookability>();
  for (const p of profiles) {
    const id = String(p.userId);
    const entry = perStylist.get(id) ?? { active: [], pending: false };
    map.set(id, decideBookability(p, entry.active, entry.pending));
  }
  return map;
}
