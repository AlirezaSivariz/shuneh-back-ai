import { ServiceCategory } from '../../models/ServiceCategory';
import { Service } from '../../models/Service';

/**
 * List all categories with their services nested, ordered for UI display.
 */
export async function listCategoriesWithServices() {
  const categories = await ServiceCategory.find().sort({ order: 1, name: 1 }).lean();
  const services = await Service.find().sort({ name: 1 }).lean();

  const byCategory = new Map<string, typeof services>();
  for (const svc of services) {
    const key = String(svc.categoryId);
    if (!byCategory.has(key)) byCategory.set(key, []);
    byCategory.get(key)!.push(svc);
  }

  return categories.map((cat) => ({
    id: String(cat._id),
    name: cat.name,
    slug: cat.slug,
    description: cat.description,
    order: cat.order,
    services: (byCategory.get(String(cat._id)) ?? []).map((s) => ({
      id: String(s._id),
      name: s.name,
      durationMin: s.durationMin,
      defaultPrice: s.defaultPrice,
      description: s.description,
    })),
  }));
}
