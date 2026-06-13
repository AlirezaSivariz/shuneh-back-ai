import { User, Role, ROLES } from '../../models/User';
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
    if (!ROLES.includes(role)) {
      throw AppError.badRequest(`Unknown role: ${role}`, 'INVALID_ROLE');
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
    },
    onboardingStep: profile?.onboardingStep ?? 'role',
    status: profile?.status ?? 'draft',
    isAcceptingReservations: profile?.isAcceptingReservations ?? true,
    workplaceType: profile?.workplaceType ?? null,
    freelance: profile?.freelance ?? null,
    portfolio: profile?.portfolio ?? [],
    services,
    salons: salonLinks,
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

  const hasPersonalInfo = !!user.firstName && !!user.nationalCode;
  const [stylist, salonsCount] = await Promise.all([
    getStylistRoleState(userId),
    user.roles.includes('owner') ? Salon.countDocuments({ ownerId: userId }) : Promise.resolve(0),
  ]);

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
    },
    roles: user.roles,
    hasPersonalInfo,
    // Per-role state — independent; adding a role never clobbers the others.
    stylist,
    owner: user.roles.includes('owner') ? { salonsCount } : null,
    customer: user.roles.includes('customer') ? { ready: hasPersonalInfo } : null,
  };
}

/** Step 1 — personal info. */
export async function updatePersonal(
  userId: string,
  data: {
    firstName: string;
    lastName: string;
    nationalCode: string;
    birthDate: Date;
  },
): Promise<void> {
  const user = await User.findById(userId);
  if (!user) throw AppError.notFound('User not found', 'USER_NOT_FOUND');

  user.firstName = data.firstName;
  user.lastName = data.lastName;
  user.nationalCode = data.nationalCode;
  user.birthDate = data.birthDate;
  await user.save();

  if (user.roles.includes('stylist')) {
    const profile = await ensureStylistProfile(userId);
    await advanceStep(profile, 'personal');
  }
}
