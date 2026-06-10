import { ServiceCategory } from '../models/ServiceCategory';
import { Service } from '../models/Service';
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
 * Auto-seed used on server startup: only seeds when the catalogue is empty,
 * so existing/customized data is never touched.
 */
export async function autoSeedIfEmpty(): Promise<void> {
  const existing = await ServiceCategory.estimatedDocumentCount();
  if (existing > 0) {
    // eslint-disable-next-line no-console
    console.log(`[seed] catalogue present (${existing} categories) — skipping auto-seed`);
    return;
  }

  // eslint-disable-next-line no-console
  console.log('[seed] empty catalogue detected — running auto-seed');
  const result = await seedServiceCatalogue();
  // eslint-disable-next-line no-console
  console.log(`[seed] auto-seed done: ${result.categories} categories, ${result.services} services`);
}
