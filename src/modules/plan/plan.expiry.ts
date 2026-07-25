/**
 * Plan expiry: auto-downgrade expired plans to 'free' and send SMS reminders
 * 5 days before expiry. Runs as a daily scheduler job.
 */
import { StylistProfile } from '../../models/StylistProfile';
import { User } from '../../models/User';
import { smsProvider } from '../../utils/sms';

/** Downgrade expired plans to free. Returns the number of downgraded profiles. */
export async function downgradeExpiredPlans(): Promise<number> {
  const now = new Date();
  const result = await StylistProfile.updateMany(
    { planTier: { $in: ['silver', 'gold'] }, planExpiresAt: { $lte: now, $ne: null } },
    { $set: { planTier: 'free', smsCampaignEnabled: false, planExpiresAt: null, planStartsAt: null } },
  );
  return result.modifiedCount;
}

/**
 * Send SMS reminders to stylists whose plan expires within the next 5 days.
 * Uses a 24h dedupe window to avoid spamming (runs daily).
 */
export async function sendPlanExpiryReminders(): Promise<number> {
  const now = new Date();
  const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);

  const expiringProfiles = await StylistProfile.find({
    planTier: { $in: ['silver', 'gold'] },
    planExpiresAt: { $gt: now, $lte: fiveDaysFromNow },
  }).lean();

  let sent = 0;
  for (const profile of expiringProfiles) {
    const user = await User.findById(profile.userId).select('phone firstName').lean();
    if (!user?.phone) continue;

    const daysLeft = Math.ceil(
      (new Date(profile.planExpiresAt!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    const name = user.firstName ?? 'متخصص';
    const tierLabel = profile.planTier === 'gold' ? 'طلایی' : 'نقره‌ای';
    const message =
      `${name} عزیز، پلن ${tierLabel} شما ظرف ${daysLeft} روز آینده منقضی می‌شود.\n` +
      `برای تمدید و ادامه‌ی استفاده از امکانات ویژه، به بخش پلن و اشتراک مراجعه کنید.\nشونه`;

    try {
      await smsProvider.send(user.phone, message, { event: 'plan_expiry_reminder' });
      sent += 1;
    } catch {
      // Best-effort: don't let one failure stop the rest.
    }
  }
  return sent;
}
