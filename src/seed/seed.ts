import { ServiceCategory } from '../models/ServiceCategory';
import { Service } from '../models/Service';
import { Salon } from '../models/Salon';
import { StylistProfile } from '../models/StylistProfile';
import { BlogPost } from '../models/BlogPost';
import { Promotion } from '../models/Promotion';
import { seedCategories } from './data';

/**
 * Idempotent upsert of the default service catalogue.
 * Categories are matched by slug, services by (categoryId, name), so running
 * this repeatedly never creates duplicates. Safe to call on every boot.
 *
 * Returns the number of categories and services processed.
 */
export async function seedServiceCatalogue(): Promise<{ categories: number; services: number }> {
  let serviceCount = 0;

  for (const cat of seedCategories) {
    const category = await ServiceCategory.findOneAndUpdate(
      { slug: cat.slug },
      {
        $set: {
          name: cat.name,
          description: cat.description,
          order: cat.order,
          isDefault: true,
        },
      },
      { upsert: true, new: true },
    );

    for (const svc of cat.services) {
      await Service.findOneAndUpdate(
        { categoryId: category._id, name: svc.name },
        {
          $set: {
            durationMin: svc.durationMin,
            defaultPrice: svc.defaultPrice,
            description: svc.description,
            isDefault: true,
          },
        },
        { upsert: true },
      );
      serviceCount += 1;
    }
  }

  return { categories: seedCategories.length, services: serviceCount };
}

/**
 * Auto-seed on server startup. The upsert is idempotent (match by slug /
 * (categoryId, name)), so this runs on EVERY boot to make sure the full default
 * catalogue is present — including categories/services added later — WITHOUT
 * ever creating duplicates. Stylist-created custom services are untouched.
 */
export async function autoSeedIfEmpty(): Promise<void> {
  const result = await seedServiceCatalogue();
  // eslint-disable-next-line no-console
  console.log(`[seed] catalogue ensured: ${result.categories} categories, ${result.services} services`);
}

/**
 * One-time migration for the removal of the 'unisex' service gender (now only
 * women|men). Legacy salons stored 'unisex' which is no longer a valid enum
 * value; we UNSET it so those docs stay valid and the owner re-picks women/men
 * on their next edit (they simply won't match a gender filter until then).
 * Idempotent — once cleared there's nothing to update on subsequent boots.
 */
export async function migrateLegacySalonServiceGender(): Promise<void> {
  const res = await Salon.updateMany(
    { serviceGender: 'unisex' },
    { $unset: { serviceGender: '' } },
  );
  const n = (res as { modifiedCount?: number }).modifiedCount ?? 0;
  if (n > 0) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] cleared legacy 'unisex' serviceGender on ${n} salon(s)`);
  }
}

/**
 * Backfill the new `planTier` from the pre-existing `smsCampaignEnabled` flag:
 * stylists who already had the SMS campaign enabled become 'silver', the rest
 * stay 'free'. Idempotent — only touches docs missing `planTier`.
 */
export async function migrateStylistPlanTier(): Promise<void> {
  const [silver, free] = await Promise.all([
    StylistProfile.updateMany(
      { planTier: { $exists: false }, smsCampaignEnabled: true },
      { $set: { planTier: 'silver' } },
    ),
    StylistProfile.updateMany(
      { planTier: { $exists: false }, smsCampaignEnabled: { $ne: true } },
      { $set: { planTier: 'free' } },
    ),
  ]);
  const n =
    ((silver as { modifiedCount?: number }).modifiedCount ?? 0) +
    ((free as { modifiedCount?: number }).modifiedCount ?? 0);
  if (n > 0) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] backfilled planTier on ${n} stylist profile(s)`);
  }
}

/**
 * Repair blog cover images that were stored as a resolved URL (and re-prefixed
 * on every edit → «…/images/…/images/…»). Recover the bare storage key from the
 * last «/images/» segment so `coverUrl` resolves it correctly once.
 */
export async function migrateBlogCoverKeys(): Promise<void> {
  const bad = await BlogPost.find({ coverImage: { $regex: '^https?://' } }).select('_id coverImage');
  let fixed = 0;
  for (const post of bad) {
    const tail = (post.coverImage as string).split('/images/').pop();
    if (!tail) continue;
    let key = tail;
    try {
      key = decodeURIComponent(tail);
    } catch {
      /* keep raw */
    }
    post.coverImage = key;
    await post.save();
    fixed += 1;
  }
  if (fixed > 0) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] normalized blog cover key on ${fixed} post(s)`);
  }
}

/**
 * Backfill the new `Promotion` collection from the legacy `StylistProfile`
 * promotion flags: any profile flagged `isPromoted` with a `promotedUntil`
 * becomes a GENERAL promotion (categoryId=null). Idempotent — only creates a
 * row when the stylist has no general promotion yet.
 */
export async function migratePromotions(): Promise<void> {
  const promoted = await StylistProfile.find({
    isPromoted: true,
    promotedUntil: { $ne: null },
  })
    .select('userId promotedUntil')
    .lean();
  let n = 0;
  for (const p of promoted) {
    if (!p.promotedUntil) continue;
    const exists = await Promotion.findOne({ stylistId: p.userId, categoryId: null }).select('_id').lean();
    if (exists) continue;
    await Promotion.create({ stylistId: p.userId, categoryId: null, promotedUntil: p.promotedUntil });
    n += 1;
  }
  if (n > 0) {
    // eslint-disable-next-line no-console
    console.log(`[migrate] created ${n} general promotion(s) from legacy flags`);
  }
}
