import { Types } from 'mongoose';
import { UserFeatureOverride, FeatureKey, FEATURE_KEYS } from '../../models/UserFeatureOverride';
import { AppError } from '../../utils/AppError';

export async function getFeatureOverride(
  userId: string,
  featureKey: FeatureKey,
): Promise<boolean | null> {
  const override = await UserFeatureOverride.findOne({ userId, featureKey });
  return override ? override.enabled : null;
}

export async function setFeatureOverride(
  adminId: string,
  userId: string,
  featureKey: FeatureKey,
  enabled: boolean,
): Promise<void> {
  if (!FEATURE_KEYS.includes(featureKey)) {
    throw AppError.badRequest(`ویژگی "${featureKey}" معتبر نیست`);
  }

  await UserFeatureOverride.findOneAndUpdate(
    { userId, featureKey },
    { userId: new Types.ObjectId(userId), featureKey, enabled, updatedBy: new Types.ObjectId(adminId) },
    { upsert: true, new: true },
  );
}

export async function removeFeatureOverride(
  userId: string,
  featureKey: FeatureKey,
): Promise<void> {
  const result = await UserFeatureOverride.findOneAndDelete({ userId, featureKey });
  if (!result) throw AppError.notFound('override یافت نشد');
}

export async function getAllOverridesForUser(
  userId: string,
): Promise<Record<string, boolean>> {
  const overrides = await UserFeatureOverride.find({ userId }).lean();
  const result: Record<string, boolean> = {};
  for (const o of overrides) {
    result[o.featureKey] = o.enabled;
  }
  return result;
}

export async function listAllOverrides(query: {
  userId?: string;
  page?: number;
  limit?: number;
}): Promise<{ items: Record<string, any>[]; total: number; page: number; totalPages: number }> {
  const page = Math.max(1, query.page ?? 1);
  const limit = Math.min(50, Math.max(1, query.limit ?? 20));
  const filter: Record<string, any> = {};
  if (query.userId) filter.userId = query.userId;

  const [raw, total] = await Promise.all([
    UserFeatureOverride.find(filter)
      .populate('userId', 'firstName lastName phone')
      .populate('updatedBy', 'firstName lastName')
      .sort({ createdAt: -1 })
      .skip((page - 1) * limit)
      .limit(limit)
      .lean(),
    UserFeatureOverride.countDocuments(filter),
  ]);

  const items = raw.map((o) => ({
    id: String(o._id),
    userId: String((o.userId as any)._id ?? o.userId),
    userPhone: (o.userId as any).phone ?? '',
    userName: (o.userId as any)
      ? `${(o.userId as any).firstName ?? ''} ${(o.userId as any).lastName ?? ''}`.trim()
      : '',
    featureKey: o.featureKey,
    enabled: o.enabled,
    updatedBy: o.updatedBy ? String((o.updatedBy as any)._id ?? o.updatedBy) : null,
    createdAt: o.createdAt?.toISOString?.() ?? '',
    updatedAt: o.updatedAt?.toISOString?.() ?? '',
  }));

  return { items, total, page, totalPages: Math.ceil(total / limit) };
}

export async function checkFeatureAccess(
  userId: string,
  featureKey: FeatureKey,
): Promise<boolean> {
  const override = await getFeatureOverride(userId, featureKey);
  if (override !== null) return override;
  return true;
}
