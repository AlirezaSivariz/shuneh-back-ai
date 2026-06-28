/**
 * Active-promotion lookups, shared by public search and the landing feed. One
 * bulk query resolves "who is promoted right now (general + per category)".
 */
import { Types } from 'mongoose';
import { Promotion } from '../../models/Promotion';

export interface PromoEntry {
  /** Has an active general (categoryId=null) promotion. */
  general: boolean;
  /** Category ids this stylist is actively promoted in. */
  categories: Set<string>;
}

/** Active promotions per stylist (single query; Iran-fixed "now"). */
export async function getActivePromotionMap(
  stylistIds: (string | Types.ObjectId)[],
): Promise<Map<string, PromoEntry>> {
  const map = new Map<string, PromoEntry>();
  const ids = [...new Set(stylistIds.map(String))];
  if (ids.length === 0) return map;

  const promos = await Promotion.find({
    stylistId: { $in: ids },
    promotedUntil: { $gt: new Date() },
  })
    .select('stylistId categoryId')
    .lean();

  for (const p of promos) {
    const sid = String(p.stylistId);
    const entry = map.get(sid) ?? { general: false, categories: new Set<string>() };
    if (p.categoryId == null) entry.general = true;
    else entry.categories.add(String(p.categoryId));
    map.set(sid, entry);
  }
  return map;
}

/**
 * Whether the stylist is promoted in the CURRENT browse context: when a category
 * filter is active → promoted in that category; otherwise → the general slot.
 */
export function isContextPromoted(entry: PromoEntry | undefined, categoryId?: string): boolean {
  if (!entry) return false;
  return categoryId ? entry.categories.has(categoryId) : entry.general;
}

/** Any active promotion at all (for the stylist's own profile "ویژه" badge). */
export function isAnyPromoted(entry: PromoEntry | undefined): boolean {
  return !!entry && (entry.general || entry.categories.size > 0);
}
