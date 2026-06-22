import { ServiceCategory } from '../models/ServiceCategory';
import { Service } from '../models/Service';
import { Salon } from '../models/Salon';
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
