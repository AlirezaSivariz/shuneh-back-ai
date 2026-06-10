/**
 * Admin operations. Currently only stylist promotion (paid placement), set
 * MANUALLY until billing exists.
 *
 * TODO(payments): this is the integration point for the future payment gateway
 * & invoicing. When a stylist purchases promotion, the successful payment
 * callback should call promoteStylist(...) with the paid `until`/`tier`. No
 * payment logic lives here yet.
 */
import { StylistProfile } from '../../models/StylistProfile';
import { AppError } from '../../utils/AppError';

function summarize(stylistId: string, p: {
  isPromoted: boolean;
  promotedUntil: Date | null;
  promotionTier?: number | null;
}) {
  return {
    stylistId,
    isPromoted: p.isPromoted,
    promotedUntil: p.promotedUntil,
    promotionTier: p.promotionTier ?? null,
  };
}

export async function promoteStylist(stylistId: string, until: Date, tier?: number) {
  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (!profile) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');

  profile.isPromoted = true;
  profile.promotedUntil = until;
  profile.promotionTier = tier ?? null;
  await profile.save();

  return summarize(stylistId, profile);
}

export async function unpromoteStylist(stylistId: string) {
  const profile = await StylistProfile.findOne({ userId: stylistId });
  if (!profile) throw AppError.notFound('متخصص یافت نشد', 'STYLIST_NOT_FOUND');

  profile.isPromoted = false;
  profile.promotedUntil = null;
  profile.promotionTier = null;
  await profile.save();

  return summarize(stylistId, profile);
}
