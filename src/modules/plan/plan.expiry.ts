/**
 * Plan expiry: auto-downgrade expired plans to 'free' and send SMS reminders
 * once per milestone (5 / 3 / 1 days before expiry). Runs as an hourly
 * scheduler job; milestone tracking on the profile guarantees each reminder is
 * sent at most once per plan period.
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

type ExpiryReminderMilestone = 'd5' | 'd3' | 'd1';

/** Pick the milestone that applies given the whole days left until expiry. */
function expiryMilestoneFor(daysUntil: number): ExpiryReminderMilestone | null {
  if (daysUntil <= 1) return 'd1';
  if (daysUntil <= 3) return 'd3';
  if (daysUntil <= 5) return 'd5';
  return null;
}

/**
 * Send SMS reminders to stylists whose plan expires within the next 5 days.
 * Each milestone ('d5' / 'd3' / 'd1') is claimed atomically on the profile, so
 * a reminder is sent at most ONCE per plan period — never repeatedly even
 * though the scheduler runs every hour.
 */
export async function sendPlanExpiryReminders(): Promise<number> {
  const now = new Date();
  const fiveDaysFromNow = new Date(now.getTime() + 5 * 24 * 60 * 60 * 1000);

  const expiringProfiles = await StylistProfile.find({
    planTier: { $in: ['silver', 'gold'] },
    planExpiresAt: { $gt: now, $lte: fiveDaysFromNow },
  }).lean();

  let sent = 0;
  for (const profile of expiringProfiles) {
    const daysUntil = Math.ceil(
      (new Date(profile.planExpiresAt!).getTime() - now.getTime()) / (24 * 60 * 60 * 1000),
    );
    const milestone = expiryMilestoneFor(daysUntil);
    if (!milestone) continue;

    // At-most-once: atomically claim the milestone for the current plan period.
    // A profile already carrying it (or a concurrent run winning the race)
    // returns null and is skipped — never a duplicate for the same milestone.
    const claimed = await StylistProfile.findOneAndUpdate(
      { _id: profile._id, expiryRemindersSent: { $ne: milestone } },
      { $push: { expiryRemindersSent: milestone } },
    ).lean();
    if (!claimed) continue;

    const user = await User.findById(profile.userId).select('phone firstName').lean();
    if (!user?.phone) continue;

    const name = user.firstName ?? 'متخصص';
    const tierLabel = profile.planTier === 'gold' ? 'طلایی' : 'نقره‌ای';
    const message =
      `${name} عزیز، پلن ${tierLabel} شما ظرف ${daysUntil} روز آینده منقضی می‌شود.\n` +
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
