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
  files: { profilePhoto?: Express.Multer.File[]; portfolio?: Express.Multer.File[] },
) {
  const profile = await ensureStylistProfile(stylistId);

  const profilePhotoFile = files.profilePhoto?.[0];
  const portfolioFiles = files.portfolio ?? [];

  if (!profilePhotoFile && portfolioFiles.length === 0) {
    throw AppError.badRequest('Provide a profile photo or portfolio images', 'NO_FILES');
  }

  if (profilePhotoFile) {
    const stored = await storageProvider.save(profilePhotoFile);
    await User.updateOne({ _id: stylistId }, { profilePhoto: stored.path });
  }

  if (portfolioFiles.length > 0) {
    const storedPaths: string[] = [];
    for (const file of portfolioFiles) {
      const stored = await storageProvider.save(file);
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
  };
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
    throw AppError.notFound('Portfolio item not found', 'PORTFOLIO_ITEM_NOT_FOUND');
  }

  profile.portfolio.splice(idx, 1);
  await profile.save();
  await storageProvider.delete(key);

  return {
    portfolio: profile.portfolio,
    portfolioUrls: profile.portfolio.map((p) => storageProvider.getUrl(p)),
  };
}
