import { User } from '../../models/User';
import { storageProvider } from '../../utils/storage';
import { AppError } from '../../utils/AppError';
import { ensureStylistProfile } from '../onboarding/onboarding.service';

/**
 * Step 5 — store the profile photo and portfolio images, then mark onboarding
 * complete and activate the stylist profile.
 */
export async function saveStylistMedia(
  stylistId: string,
  files: {
    profilePhoto?: Express.Multer.File[];
    portfolio?: Express.Multer.File[];
    cover?: Express.Multer.File[];
  },
) {
  const profile = await ensureStylistProfile(stylistId);

  const profilePhotoFile = files.profilePhoto?.[0];
  const coverFile = files.cover?.[0];
  const portfolioFiles = files.portfolio ?? [];

  if (!profilePhotoFile && !coverFile && portfolioFiles.length === 0) {
    throw AppError.badRequest(
      'یک عکس پروفایل، تصویر کاور یا نمونه‌کار انتخاب کنید',
      'NO_FILES',
    );
  }

  if (profilePhotoFile) {
    const stored = await storageProvider.save(profilePhotoFile, {
      ownerType: 'user',
      ownerId: stylistId,
      kind: 'profile',
    });
    await User.updateOne({ _id: stylistId }, { profilePhoto: stored.path });
  }

  if (coverFile) {
    const stored = await storageProvider.save(coverFile, {
      ownerType: 'stylist',
      ownerId: stylistId,
      kind: 'cover',
    });
    profile.cover = stored.path;
  }

  if (portfolioFiles.length > 0) {
    const storedPaths: string[] = [];
    for (const file of portfolioFiles) {
      const stored = await storageProvider.save(file, {
        ownerType: 'stylist',
        ownerId: stylistId,
        kind: 'portfolio',
      });
      storedPaths.push(stored.path);
    }
    profile.portfolio = [...profile.portfolio, ...storedPaths];
  }

  // Finalize onboarding.
  profile.onboardingStep = 'completed';
  profile.status = 'active';
  await profile.save();

  const user = await User.findById(stylistId);

  return {
    onboardingStep: profile.onboardingStep,
    status: profile.status,
    profilePhoto: user?.profilePhoto ? storageProvider.getUrl(user.profilePhoto) : null,
    portfolio: profile.portfolio.map((p) => storageProvider.getUrl(p)),
    cover: profile.cover ? storageProvider.getUrl(profile.cover) : null,
  };
}

/**
 * Set/replace the authenticated user's profile photo (any role). Stores the
 * image and saves its key on User.profilePhoto; returns the absolute URL.
 */
export async function saveProfilePhoto(userId: string, file?: Express.Multer.File) {
  if (!file) throw AppError.badRequest('عکسی انتخاب نشده است', 'NO_FILE');
  const stored = await storageProvider.save(file, {
    ownerType: 'user',
    ownerId: userId,
    kind: 'profile',
  });
  await User.updateOne({ _id: userId }, { profilePhoto: stored.path });
  return { profilePhoto: storageProvider.getUrl(stored.path) };
}

/**
 * Remove a single portfolio image (post-onboarding management). `key` is the
 * stored key as held in the profile (the value the client received from the
 * onboarding state). The image file is deleted best-effort.
 */
export async function deletePortfolioItem(stylistId: string, key: string) {
  const profile = await ensureStylistProfile(stylistId);

  const idx = profile.portfolio.indexOf(key);
  if (idx === -1) {
    throw AppError.notFound('نمونه‌کار یافت نشد', 'PORTFOLIO_ITEM_NOT_FOUND');
  }

  profile.portfolio.splice(idx, 1);
  await profile.save();
  await storageProvider.delete(key);

  return {
    portfolio: profile.portfolio,
    portfolioUrls: profile.portfolio.map((p) => storageProvider.getUrl(p)),
  };
}

/**
 * Remove the stylist's public cover image (post-onboarding management). The
 * stored file is deleted best-effort; returns the cleared value so the client
 * can reset its preview.
 */
export async function deleteCover(stylistId: string) {
  const profile = await ensureStylistProfile(stylistId);
  if (!profile.cover) throw AppError.notFound('کاور یافت نشد', 'COVER_NOT_FOUND');

  const old = profile.cover;
  profile.cover = undefined;
  await profile.save();
  await storageProvider.delete(old);

  return { cover: null };
}
