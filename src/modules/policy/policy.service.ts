/**
 * Central cancellation/reschedule policy logic — the SINGLE source of truth for:
 *  - the system default policy + plan presets,
 *  - per-plan validation (server-side enforcement),
 *  - inheritance/resolution (which policy applies to a given reservation), and
 *  - refund/penalty CALCULATION.
 *
 * IMPORTANT: this layer only DEFINES + DISPLAYS policies and COMPUTES the
 * refund/penalty figures. It does NOT move any money — there is no payment
 * gateway / deposit yet. The computed outcome is returned (and snapshotted on
 * the reservation) so a future settlement engine can act on it. Search for
 * `TODO(settlement)` for the seam where real wallet/refund calls will go.
 */
import { Types } from 'mongoose';
import {
  ICancellationPolicy,
  ICancellationRule,
} from '../../models/cancellationPolicy';
import { StylistProfile, PlanTier } from '../../models/StylistProfile';
import { Salon } from '../../models/Salon';
import { StylistSalon } from '../../models/StylistSalon';
import { Service } from '../../models/Service';
import { AppError } from '../../utils/AppError';

export type PolicySource = 'stylist_service' | 'stylist' | 'salon' | 'system';

/**
 * Reasonable system default (also the salon default suggested in the UI):
 *  - ≥24h before start → 100% refund (free),
 *  - ≥6h               → 50% refund,
 *  - ≥2h               → 0% refund,
 *  - <2h               → 0% (no rule matched).
 * One free reschedule, then a 20% penalty.
 */
export const SYSTEM_DEFAULT_POLICY: ICancellationPolicy = {
  rules: [
    { hoursBeforeStart: 24, refundPercent: 100 },
    { hoursBeforeStart: 6, refundPercent: 50 },
    { hoursBeforeStart: 2, refundPercent: 0 },
  ],
  freeRescheduleCount: 1,
  reschedulePenaltyPercent: 20,
};

/** Silver stylists may only use these standard thresholds (hours before start). */
export const SILVER_ALLOWED_HOURS = [12, 6, 2];

/** Gold stylists may use any threshold in this (sane) range. */
const GOLD_MIN_HOURS = 0;
const GOLD_MAX_HOURS = 720; // 30 days
const MAX_RULES = 6;

/** Sort rules by threshold DESC + drop exact-duplicate thresholds (last wins). */
export function normalizePolicy(policy: ICancellationPolicy): ICancellationPolicy {
  const byThreshold = new Map<number, ICancellationRule>();
  for (const r of policy.rules ?? []) {
    byThreshold.set(r.hoursBeforeStart, {
      hoursBeforeStart: r.hoursBeforeStart,
      refundPercent: r.refundPercent,
    });
  }
  const rules = [...byThreshold.values()].sort(
    (a, b) => b.hoursBeforeStart - a.hoursBeforeStart,
  );
  return {
    rules,
    freeRescheduleCount: Math.max(0, Math.trunc(policy.freeRescheduleCount ?? 0)),
    reschedulePenaltyPercent: clampPercent(policy.reschedulePenaltyPercent ?? 0),
  };
}

function clampPercent(n: number): number {
  return Math.min(100, Math.max(0, Math.round(n)));
}

/** Structural validation common to every plan. */
function assertShape(policy: ICancellationPolicy): void {
  if (!policy || !Array.isArray(policy.rules)) {
    throw AppError.badRequest('سیاست کنسلی نامعتبر است', 'POLICY_INVALID');
  }
  if (policy.rules.length === 0) {
    throw AppError.badRequest('حداقل یک بازه‌ی کنسلی لازم است', 'POLICY_NO_RULES');
  }
  if (policy.rules.length > MAX_RULES) {
    throw AppError.badRequest(`حداکثر ${MAX_RULES} بازه مجاز است`, 'POLICY_TOO_MANY_RULES');
  }
  for (const r of policy.rules) {
    if (!Number.isFinite(r.hoursBeforeStart) || r.hoursBeforeStart < 0) {
      throw AppError.badRequest('ساعت بازه نامعتبر است', 'POLICY_BAD_HOURS');
    }
    if (!Number.isFinite(r.refundPercent) || r.refundPercent < 0 || r.refundPercent > 100) {
      throw AppError.badRequest('درصد بازگشت باید بین ۰ تا ۱۰۰ باشد', 'POLICY_BAD_PERCENT');
    }
  }
}

/**
 * Enforce plan limits on a policy the stylist is trying to save. `free` cannot
 * set any policy; `silver` is limited to the standard thresholds + no
 * per-service; `gold` is unrestricted. Returns the NORMALIZED policy.
 */
export function validatePolicyForPlan(
  plan: PlanTier,
  policy: ICancellationPolicy,
  opts: { perService?: boolean } = {},
): ICancellationPolicy {
  if (plan === 'free') {
    throw AppError.forbidden(
      'تعیین سیاست کنسلی اختصاصی فقط برای پلن‌های نقره‌ای و طلایی است؛ پلن رایگان از سیاست سالن پیروی می‌کند.',
      'POLICY_PLAN_FREE',
    );
  }
  if (opts.perService && plan !== 'gold') {
    throw AppError.forbidden(
      'سیاست جداگانه برای هر خدمت فقط در پلن طلایی ممکن است.',
      'POLICY_PER_SERVICE_GOLD_ONLY',
    );
  }
  assertShape(policy);

  if (plan === 'silver') {
    for (const r of policy.rules) {
      if (!SILVER_ALLOWED_HOURS.includes(r.hoursBeforeStart)) {
        throw AppError.badRequest(
          `در پلن نقره‌ای فقط بازه‌های استاندارد (${SILVER_ALLOWED_HOURS.join('، ')} ساعت) مجاز است.`,
          'POLICY_SILVER_PRESET_ONLY',
        );
      }
    }
  } else {
    // gold
    for (const r of policy.rules) {
      if (r.hoursBeforeStart < GOLD_MIN_HOURS || r.hoursBeforeStart > GOLD_MAX_HOURS) {
        throw AppError.badRequest('ساعت بازه خارج از محدوده‌ی مجاز است', 'POLICY_HOURS_RANGE');
      }
    }
  }
  return normalizePolicy(policy);
}

/**
 * Validate a SALON (owner-defined) policy. The salon default isn't plan-gated —
 * owners may use any sane thresholds — so this only checks structure + normalizes.
 */
export function validateOwnerPolicy(policy: ICancellationPolicy): ICancellationPolicy {
  assertShape(policy);
  for (const r of policy.rules) {
    if (r.hoursBeforeStart > GOLD_MAX_HOURS) {
      throw AppError.badRequest('ساعت بازه خارج از محدوده‌ی مجاز است', 'POLICY_HOURS_RANGE');
    }
  }
  return normalizePolicy(policy);
}

function hasRules(p?: ICancellationPolicy | null): p is ICancellationPolicy {
  return !!p && Array.isArray(p.rules) && p.rules.length > 0;
}

/**
 * Everything the stylist's "cancellation policy" settings screen needs: their
 * plan, their own general + per-service policies (with service names), the salon
 * policy they'd otherwise inherit, the system default, and the plan presets.
 */
export async function getStylistPolicyOverview(stylistId: string) {
  const profile = await StylistProfile.findOne({ userId: stylistId })
    .select('planTier cancellationPolicy servicePolicies')
    .lean();
  if (!profile) throw AppError.notFound('پروفایل متخصص یافت نشد', 'PROFILE_NOT_FOUND');

  const plan = (profile.planTier ?? 'free') as PlanTier;

  // The salon policy this stylist would inherit (first active membership in an
  // active salon). Freelancers / no active salon → null (system default applies).
  let salonPolicy: { salonId: string; salonName: string; policy: ICancellationPolicy | null } | null = null;
  const link = await StylistSalon.findOne({ stylistId, status: 'active' })
    .select('salonId')
    .lean();
  if (link) {
    const salon = await Salon.findOne({ _id: link.salonId, status: 'active' })
      .select('name cancellationPolicy')
      .lean();
    if (salon) {
      salonPolicy = {
        salonId: String(salon._id),
        salonName: salon.name,
        policy: hasRules(salon.cancellationPolicy) ? normalizePolicy(salon.cancellationPolicy) : null,
      };
    }
  }

  // Resolve per-service policy names (gold).
  const servicePolicies = profile.servicePolicies ?? [];
  const svcIds = servicePolicies.map((sp) => sp.serviceId);
  const services = svcIds.length
    ? await Service.find({ _id: { $in: svcIds } }).select('name').lean()
    : [];
  const nameById = new Map(services.map((s) => [String(s._id), s.name]));

  return {
    plan,
    cancellationPolicy: hasRules(profile.cancellationPolicy)
      ? normalizePolicy(profile.cancellationPolicy)
      : null,
    servicePolicies: servicePolicies.map((sp) => ({
      serviceId: String(sp.serviceId),
      serviceName: nameById.get(String(sp.serviceId)) ?? 'خدمت',
      policy: normalizePolicy(sp.policy),
    })),
    salon: salonPolicy,
    systemDefault: SYSTEM_DEFAULT_POLICY,
    presets: { silverAllowedHours: SILVER_ALLOWED_HOURS, goldMaxHours: GOLD_MAX_HOURS },
  };
}

export interface ResolvedPolicy {
  policy: ICancellationPolicy;
  source: PolicySource;
}

/**
 * Resolve which policy applies to a reservation, by priority:
 *   1) stylist per-service policy (gold) matching one of the booked services,
 *   2) stylist general policy,
 *   3) salon policy,
 *   4) system default.
 */
export async function resolveCancellationPolicy(input: {
  stylistId: string;
  salonId?: string | null;
  serviceIds: string[];
}): Promise<ResolvedPolicy> {
  const profile = await StylistProfile.findOne({ userId: input.stylistId })
    .select('cancellationPolicy servicePolicies')
    .lean();

  // 1) per-service override (first booked service that has one).
  if (profile?.servicePolicies?.length) {
    const wanted = new Set(input.serviceIds.map(String));
    for (const sid of input.serviceIds) {
      const match = profile.servicePolicies.find(
        (sp) => String(sp.serviceId) === String(sid) && hasRules(sp.policy),
      );
      if (match) return { policy: normalizePolicy(match.policy), source: 'stylist_service' };
    }
    // (wanted kept for clarity; the loop above already honors booking order)
    void wanted;
  }

  // 2) stylist general policy.
  if (hasRules(profile?.cancellationPolicy)) {
    return { policy: normalizePolicy(profile!.cancellationPolicy!), source: 'stylist' };
  }

  // 3) salon policy.
  if (input.salonId && Types.ObjectId.isValid(input.salonId)) {
    const salon = await Salon.findById(input.salonId).select('cancellationPolicy').lean();
    if (hasRules(salon?.cancellationPolicy)) {
      return { policy: normalizePolicy(salon!.cancellationPolicy!), source: 'salon' };
    }
  }

  // 4) system default.
  return { policy: SYSTEM_DEFAULT_POLICY, source: 'system' };
}

/** A stable key for comparing two policies (ignores `source`). */
function policyKey(p: ICancellationPolicy): string {
  const n = normalizePolicy(p);
  return JSON.stringify([
    n.rules.map((r) => [r.hoursBeforeStart, r.refundPercent]),
    n.freeRescheduleCount,
    n.reschedulePenaltyPercent,
  ]);
}

export interface PerServicePolicy {
  serviceId: string;
  serviceName: string;
  policy: ResolvedPolicy;
}

/**
 * Resolve the FINAL policy for EACH service of a booking separately (so a
 * stylist who set different per-service policies is shown correctly). Returns
 * `uniform: true` when every service resolves to the same policy — then the UI
 * may show a single box; otherwise it shows one per service.
 */
export async function resolvePerServicePolicies(input: {
  stylistId: string;
  salonId?: string | null;
  serviceIds: string[];
}): Promise<{ uniform: boolean; services: PerServicePolicy[]; common: ResolvedPolicy }> {
  const ids = [...new Set(input.serviceIds.map(String))];
  const services = ids.length
    ? await Service.find({ _id: { $in: ids } }).select('name').lean()
    : [];
  const nameById = new Map(services.map((s) => [String(s._id), s.name]));

  const resolved = await Promise.all(
    ids.map(async (sid) => {
      const policy = await resolveCancellationPolicy({
        stylistId: input.stylistId,
        salonId: input.salonId,
        serviceIds: [sid],
      });
      return { serviceId: sid, serviceName: nameById.get(sid) ?? 'خدمت', policy };
    }),
  );

  // Fallback (no services) → the plain over-all resolve.
  const common =
    resolved[0]?.policy ??
    (await resolveCancellationPolicy({
      stylistId: input.stylistId,
      salonId: input.salonId,
      serviceIds: ids,
    }));
  const uniform =
    resolved.length <= 1 || new Set(resolved.map((r) => policyKey(r.policy.policy))).size === 1;

  return { uniform, services: resolved, common };
}

/** Hours between now and an absolute start instant (can be negative if past). */
export function hoursUntil(startAt: Date, now: Date = new Date()): number {
  return (startAt.getTime() - now.getTime()) / 3_600_000;
}

/** Refund percent for a given remaining-hours, per the policy's bands. */
export function refundPercentFor(policy: ICancellationPolicy, hours: number): number {
  // Highest threshold that is still ≤ remaining hours wins; none → 0%.
  const sorted = [...policy.rules].sort((a, b) => b.hoursBeforeStart - a.hoursBeforeStart);
  for (const r of sorted) {
    if (hours >= r.hoursBeforeStart) return clampPercent(r.refundPercent);
  }
  return 0;
}

export interface CancellationOutcome {
  hoursBeforeStart: number;
  refundPercent: number;
  penaltyPercent: number;
  /** Of the paid amount (whole Toman). null when the amount is unknown. */
  refundAmount: number | null;
  penaltyAmount: number | null;
  source: PolicySource;
}

/**
 * Compute the refund/penalty a cancellation WOULD incur right now. Display +
 * record only — no money is moved. `paidAmount` is whole Toman (finalPrice).
 */
export function computeCancellationOutcome(
  resolved: ResolvedPolicy,
  startAt: Date,
  paidAmount: number | null,
  now: Date = new Date(),
): CancellationOutcome {
  const hrs = hoursUntil(startAt, now);
  const refundPercent = refundPercentFor(resolved.policy, hrs);
  const penaltyPercent = 100 - refundPercent;
  const amount = typeof paidAmount === 'number' && paidAmount >= 0 ? paidAmount : null;
  return {
    hoursBeforeStart: Math.max(0, Math.round(hrs * 10) / 10),
    refundPercent,
    penaltyPercent,
    refundAmount: amount === null ? null : Math.round((amount * refundPercent) / 100),
    penaltyAmount: amount === null ? null : Math.round((amount * penaltyPercent) / 100),
    source: resolved.source,
  };
}

export interface RescheduleOutcome {
  free: boolean;
  freeRescheduleCount: number;
  usedReschedules: number;
  remainingFree: number;
  penaltyPercent: number;
  penaltyAmount: number | null;
  source: PolicySource;
}

/**
 * Compute the penalty a NEXT reschedule would incur, given how many reschedules
 * already happened. The first `freeRescheduleCount` are free; afterwards the
 * `reschedulePenaltyPercent` applies. Display + record only.
 */
export function computeRescheduleOutcome(
  resolved: ResolvedPolicy,
  usedReschedules: number,
  paidAmount: number | null,
): RescheduleOutcome {
  const free = usedReschedules < resolved.policy.freeRescheduleCount;
  const penaltyPercent = free ? 0 : clampPercent(resolved.policy.reschedulePenaltyPercent);
  const amount = typeof paidAmount === 'number' && paidAmount >= 0 ? paidAmount : null;
  return {
    free,
    freeRescheduleCount: resolved.policy.freeRescheduleCount,
    usedReschedules,
    remainingFree: Math.max(0, resolved.policy.freeRescheduleCount - usedReschedules),
    penaltyPercent,
    penaltyAmount: amount === null ? null : Math.round((amount * penaltyPercent) / 100),
    source: resolved.source,
  };
}

/** A small, client-friendly serialization of a resolved policy. */
export function serializePolicy(resolved: ResolvedPolicy) {
  return {
    source: resolved.source,
    rules: resolved.policy.rules.map((r) => ({
      hoursBeforeStart: r.hoursBeforeStart,
      refundPercent: r.refundPercent,
    })),
    freeRescheduleCount: resolved.policy.freeRescheduleCount,
    reschedulePenaltyPercent: resolved.policy.reschedulePenaltyPercent,
  };
}
