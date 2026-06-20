import { User, Role, SELF_ASSIGNABLE_ROLES } from '../../models/User';
import {
  StylistProfile,
  IStylistProfile,
  OnboardingStep,
  ONBOARDING_STEPS,
} from '../../models/StylistProfile';
import { StylistService } from '../../models/StylistService';
import { StylistSalon } from '../../models/StylistSalon';
import { WorkingHour } from '../../models/WorkingHour';
import { Salon } from '../../models/Salon';
import { AppError } from '../../utils/AppError';
import { hasPendingInvitesForPhone } from '../invite/invite.service';
import { getBookability } from '../stylist/bookability';
import { accountStatus } from '../../utils/foreignApproval';

/** Ensure a (draft) StylistProfile exists for a stylist user. */
export async function ensureStylistProfile(userId: string): Promise<IStylistProfile> {
  let profile = await StylistProfile.findOne({ userId });
  if (!profile) {
    profile = await StylistProfile.create({ userId, onboardingStep: 'role', status: 'draft' });
  }
  return profile;
}

export async function getStylistProfile(userId: string): Promise<IStylistProfile> {
  const profile = await StylistProfile.findOne({ userId });
  if (!profile) throw AppError.notFound('Stylist profile not found', 'STYLIST_PROFILE_NOT_FOUND');
  return profile;
}

/**
 * Move onboardingStep forward to (at least) the step AFTER `completedStep`.
 * Never regresses, so re-submitting an earlier step does not rewind progress.
 */
export async function advanceStep(
  profile: IStylistProfile,
  completedStep: OnboardingStep,
): Promise<void> {
  const completedIndex = ONBOARDING_STEPS.indexOf(completedStep);
  const nextStep = ONBOARDING_STEPS[Math.min(completedIndex + 1, ONBOARDING_STEPS.length - 1)];
  const currentIndex = ONBOARDING_STEPS.indexOf(profile.onboardingStep);
  if (ONBOARDING_STEPS.indexOf(nextStep) > currentIndex) {
    profile.onboardingStep = nextStep;
    await profile.save();
  }
}

/**
 * Add roles to a user (idempotent). Creates the StylistProfile when the
 * 'stylist' role is added so onboarding can begin.
 */
export async function setRoles(userId: string, roles: Role[]): Promise<Role[]> {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');

  for (const role of roles) {
    // 'admin' is never self-assignable — only the seed script can grant it.
    if (!SELF_ASSIGNABLE_ROLES.includes(role)) {
      throw AppError.badRequest(`Role not allowed: ${role}`, 'INVALID_ROLE');
    }
    if (!user.roles.includes(role)) user.roles.push(role);
  }
  await user.save();

  if (user.roles.includes('stylist')) {
    const profile = await ensureStylistProfile(userId);
    await advanceStep(profile, 'role');
  }

  return user.roles;
}

/**
 * Aggregate the full onboarding state: current step plus everything already
 * captured, so the client can resume exactly where the stylist left off.
 */
export async function getOnboardingState(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');

  const profile = await StylistProfile.findOne({ userId });

  const [services, salonLinks, workingHours] = profile
    ? await Promise.all([
        StylistService.find({ stylistId: userId }).populate('serviceId'),
        StylistSalon.find({ stylistId: userId }).populate('salonId'),
        WorkingHour.find({ stylistId: userId }),
      ])
    : [[], [], []];

  // Salons this user OWNS (independent of any stylist membership) — lets the
  // owner onboarding flow know whether the "create first salon" step is done.
  const ownedSalonsCount = user.roles.includes('owner')
    ? await Salon.countDocuments({ ownerId: userId })
    : 0;

  return {
    user: {
      id: String(user._id),
      phone: user.phone,
      roles: user.roles,
      firstName: user.firstName,
      lastName: user.lastName,
      nationalCode: user.nationalCode,
      birthDate: user.birthDate,
      profilePhoto: user.profilePhoto,
      isForeignNational: user.isForeignNational ?? false,
      foreignId: user.foreignId ?? null,
      foreignApprovalStatus: user.foreignApprovalStatus ?? 'not_required',
      foreignRejectionReason: user.foreignRejectionReason ?? null,
    },
    onboardingStep: profile?.onboardingStep ?? 'role',
    status: profile?.status ?? 'draft',
    isAcceptingReservations: profile?.isAcceptingReservations ?? true,
    verification: {
      status: profile?.verificationStatus ?? 'incomplete',
      isVerified: profile?.isVerified ?? false,
      rejectionReason: profile?.rejectionReason ?? null,
      profileSubmittedAt: profile?.profileSubmittedAt ?? null,
      // Presence only — the private images themselves are never returned here.
      documents: {
        front: !!profile?.nationalCardFront,
        back: !!profile?.nationalCardBack,
      },
    },
    workplaceType: profile?.workplaceType ?? null,
    freelance: profile?.freelance ?? null,
    portfolio: profile?.portfolio ?? [],
    services,
    salons: salonLinks,
    ownedSalonsCount,
    workingHours,
  };
}

/** The stylist's per-role onboarding state (null if not a stylist yet). */
export async function getStylistRoleState(userId: string) {
  const profile = await StylistProfile.findOne({ userId })
    .select('onboardingStep status')
    .lean();
  return profile ? { onboardingStep: profile.onboardingStep, status: profile.status } : null;
}

/**
 * Lightweight multi-role state for the frontend to build navigation: which
 * roles the user has and the readiness/onboarding state of each. Roles are
 * additive and coexist (a user can be owner + stylist + customer at once).
 */
export async function getUserState(userId: string) {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');

  const hasPersonalInfo = !!user.firstName && (!!user.nationalCode || !!user.foreignId);
  const isStylist = user.roles.includes('stylist');
  const [stylistProfile, salonsCount, hasPendingOwnerInvites] = await Promise.all([
    isStylist
      ? StylistProfile.findOne({ userId })
          .select('onboardingStep status workplaceType freelance isAcceptingReservations needsHoursUpdate')
          .lean()
      : Promise.resolve(null),
    user.roles.includes('owner') ? Salon.countDocuments({ ownerId: userId }) : Promise.resolve(0),
    hasPendingInvitesForPhone(user.phone),
  ]);

  // For an active stylist, surface WHY they're not bookable so their panel can
  // show a clear banner (no active workplace / pending salons / not accepting).
  let stylist:
    | {
        onboardingStep: string;
        status: string;
        bookable: boolean;
        bookableReason: string | null;
        needsHoursUpdate: boolean;
      }
    | null = null;
  if (stylistProfile) {
    const book =
      stylistProfile.status === 'active'
        ? await getBookability(userId, stylistProfile)
        : null;
    stylist = {
      onboardingStep: stylistProfile.onboardingStep,
      status: stylistProfile.status,
      bookable: book?.bookable ?? false,
      bookableReason: book?.reason ?? null,
      // Hours change left future reservations out-of-hours → panel shows a banner.
      needsHoursUpdate: stylistProfile.needsHoursUpdate ?? false,
    };
  }

  // Effective account status (admin-disable + foreign-approval gate), so the
  // client can show a single "panel disabled" message with the right reason.
  const status = accountStatus(user);

  return {
    user: {
      id: String(user._id),
      phone: user.phone,
      roles: user.roles,
      firstName: user.firstName ?? null,
      lastName: user.lastName ?? null,
      nationalCode: user.nationalCode ?? null,
      birthDate: user.birthDate ?? null,
      profilePhoto: user.profilePhoto ?? null,
      isForeignNational: user.isForeignNational ?? false,
      foreignId: user.foreignId ?? null,
      foreignApprovalStatus: user.foreignApprovalStatus ?? 'not_required',
      foreignRejectionReason: user.foreignRejectionReason ?? null,
    },
    roles: user.roles,
    hasPersonalInfo,
    // Effective active flag (false for a not-yet-approved foreign national or an
    // admin-blocked account) + the reason, for the client's panel-disabled UI.
    isActive: status.active,
    inactiveReason: status.reason,
    // True when an owner-invite (by phone) is waiting — lets the client offer the
    // "continue as salon owner" path instead of the generic role question.
    hasPendingOwnerInvites,
    // Per-role state — independent; adding a role never clobbers the others.
    stylist,
    owner: user.roles.includes('owner') ? { salonsCount } : null,
    customer: user.roles.includes('customer') ? { ready: hasPersonalInfo } : null,
  };
}

/** Step 1 — personal info. Iranian users set nationalCode; foreign nationals
 * set a 12-digit foreignId and enter the admin-approval gate. */
export async function updatePersonal(
  userId: string,
  data: {
    firstName: string;
    lastName: string;
    isForeignNational?: boolean;
    nationalCode?: string;
    foreignId?: string;
    birthDate: Date;
  },
): Promise<void> {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');

  user.firstName = data.firstName;
  user.lastName = data.lastName;
  user.birthDate = data.birthDate;

  if (data.isForeignNational) {
    const foreignId = (data.foreignId ?? '').trim();
    // A foreign id may belong to exactly one account.
    const dup = await User.findOne({ foreignId, _id: { $ne: user._id } })
      .select('_id')
      .lean();
    if (dup) {
      throw AppError.conflict('این کد اختصاصی قبلاً ثبت شده است', 'FOREIGN_ID_TAKEN');
    }

    const changedId = user.foreignId !== foreignId;
    user.isForeignNational = true;
    user.foreignId = foreignId;
    user.nationalCode = undefined; // mutually exclusive with a national code
    // Enter (or re-enter) the approval gate when newly foreign or the id changed;
    // never downgrade an already-approved user on an unrelated re-save.
    if (user.foreignApprovalStatus === 'not_required' || changedId) {
      user.foreignApprovalStatus = 'pending';
      user.foreignRejectionReason = null;
    }
  } else {
    const nationalCode = (data.nationalCode ?? '').trim();
    const dup = await User.findOne({ nationalCode, _id: { $ne: user._id } })
      .select('_id')
      .lean();
    if (dup) {
      throw AppError.conflict('این کد ملی قبلاً ثبت شده است', 'NATIONAL_CODE_TAKEN');
    }
    user.isForeignNational = false;
    user.nationalCode = nationalCode;
    user.foreignId = null;
    user.foreignApprovalStatus = 'not_required';
    user.foreignRejectionReason = null;
  }

  try {
    await user.save();
  } catch (err) {
    // Safety net for the unique indexes (concurrent writes).
    if ((err as { code?: number }).code === 11000) {
      const dupKey = (err as { keyPattern?: Record<string, unknown> }).keyPattern ?? {};
      if ('foreignId' in dupKey) {
        throw AppError.conflict('این کد اختصاصی قبلاً ثبت شده است', 'FOREIGN_ID_TAKEN');
      }
      throw AppError.conflict('این کد ملی قبلاً ثبت شده است', 'NATIONAL_CODE_TAKEN');
    }
    throw err;
  }

  if (user.roles.includes('stylist')) {
    const profile = await ensureStylistProfile(userId);
    await advanceStep(profile, 'personal');
  }
}
