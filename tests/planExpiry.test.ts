import mongoose from "mongoose";
import { StylistProfile } from "../src/models/StylistProfile";
import { User } from "../src/models/User";
import {
  downgradeExpiredPlans,
  isWithinSmsWindow,
  sendPlanExpiryReminders,
} from "../src/modules/plan/plan.expiry";
import { smsProvider } from "../src/utils/sms";

// Global setup mocks ../src/utils/sms; smsProvider.send is a jest.fn here.
const sendMock = smsProvider.send as jest.Mock;

// Asia/Tehran is UTC+3:30 (no DST since 2022). Fixed instants:
// 2026-08-05T00:15:00Z -> 03:45 Tehran (the reported problematic hour)
// 2026-08-05T04:29:00Z -> 07:59 Tehran (just before window)
// 2026-08-05T07:30:00Z -> 11:00 Tehran (inside window)
// 2026-08-05T16:29:00Z -> 19:59 Tehran (just before closing)
// 2026-08-05T16:30:00Z -> 20:00 Tehran (window closed)
const T = (iso: string) => new Date(iso);

async function seedExpiringProfile(opts?: { daysUntil?: number; planTier?: "silver" | "gold" }) {
  const { daysUntil = 3, planTier = "silver" } = opts ?? {};
  const user = await User.create({ phone: "+989100000001", firstName: "مریم" });
  const planExpiresAt = new Date(T("2026-08-05T00:00:00Z").getTime() + daysUntil * 24 * 60 * 60 * 1000);
  const profile = await StylistProfile.create({ userId: user._id, planTier, planExpiresAt });
  return { user, profile };
}

describe("isWithinSmsWindow (Asia/Tehran)", () => {
  it("accepts 08:00 and 19:59, rejects 03:45 and 20:00", () => {
    // 2026-08-05T04:30:00Z -> 08:00 Tehran (start, inclusive)
    expect(isWithinSmsWindow(T("2026-08-05T04:30:00Z"))).toBe(true);
    expect(isWithinSmsWindow(T("2026-08-05T16:29:00Z"))).toBe(true); // 19:59
    expect(isWithinSmsWindow(T("2026-08-05T00:15:00Z"))).toBe(false); // 03:45
    expect(isWithinSmsWindow(T("2026-08-05T16:30:00Z"))).toBe(false); // 20:00
  });
});

describe("sendPlanExpiryReminders quiet hours", () => {
  afterEach(() => sendMock.mockClear());

  it("skips (and does NOT claim) at 03:45 Tehran, then sends on the next in-window run", async () => {
    const { profile } = await seedExpiringProfile();

    // 3:45 AM — the job must skip entirely.
    await expect(sendPlanExpiryReminders(T("2026-08-05T00:15:00Z"))).resolves.toBe(0);
    expect(sendMock).not.toHaveBeenCalled();

    const untouched = await StylistProfile.findById(profile._id).lean();
    expect(untouched!.expiryRemindersSent).toEqual([]);

    // Next daytime run (11:00 Tehran) delivers it and claims the milestone.
    await expect(sendPlanExpiryReminders(T("2026-08-05T07:30:00Z"))).resolves.toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
    expect(sendMock.mock.calls[0][0]).toBe("+989100000001");
    expect(sendMock.mock.calls[0][2]).toEqual({ event: "plan_expiry_reminder" });

    const claimed = await StylistProfile.findById(profile._id).lean();
    expect(claimed!.expiryRemindersSent).toEqual(["d3"]);
  });

  it("sends immediately when the run lands inside the window", async () => {
    await seedExpiringProfile();
    await expect(sendPlanExpiryReminders(T("2026-08-05T07:30:00Z"))).resolves.toBe(1);
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("treats 20:00 as closed and 19:59 as open", async () => {
    await seedExpiringProfile();

    await expect(sendPlanExpiryReminders(T("2026-08-05T16:30:00Z"))).resolves.toBe(0); // 20:00
    expect(sendMock).not.toHaveBeenCalled();

    await expect(sendPlanExpiryReminders(T("2026-08-05T16:29:00Z"))).resolves.toBe(1); // 19:59
    expect(sendMock).toHaveBeenCalledTimes(1);
  });

  it("keeps at-most-once per milestone inside the window", async () => {
    const { profile } = await seedExpiringProfile();

    await sendPlanExpiryReminders(T("2026-08-05T07:30:00Z"));
    await sendPlanExpiryReminders(T("2026-08-05T08:30:00Z"));

    expect(sendMock).toHaveBeenCalledTimes(1);
    const claimed = await StylistProfile.findById(profile._id).lean();
    expect(claimed!.expiryRemindersSent).toEqual(["d3"]);
  });
});

describe("downgradeExpiredPlans", () => {
  it("still downgrades regardless of the SMS window (unchanged behavior)", async () => {
    const { profile } = await seedExpiringProfile({ daysUntil: 0 });
    await StylistProfile.updateOne({ _id: profile._id }, { $set: { planTier: "gold", smsCampaignEnabled: true } });

    const count = await downgradeExpiredPlans();

    expect(count).toBe(1);
    const downgraded = await StylistProfile.findById(profile._id).lean();
    expect(downgraded!.planTier).toBe("free");
    expect(downgraded!.smsCampaignEnabled).toBe(false);
  });
});
