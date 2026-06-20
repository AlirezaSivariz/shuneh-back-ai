import { api, auth, createAdmin, createCustomer, login } from "./helpers";
import { SmsLog } from "../src/models/SmsLog";

describe("Admin — user suspension (with reason)", () => {
  it("suspends a user with a reason; the user is then blocked and reason is stored", async () => {
    const admin = await createAdmin();
    const customer = await createCustomer();

    const suspend = await api()
      .patch(`/admin/users/${customer.id}/status`)
      .set(...auth(admin.token))
      .send({ isActive: false, reason: "تخلف مکرر" });
    expect(suspend.status).toBe(200);
    expect(suspend.body.data.suspendedReason).toBe("تخلف مکرر");

    // Admin detail shows the reason + effective inactivity.
    const detail = await api().get(`/admin/users/${customer.id}`).set(...auth(admin.token));
    expect(detail.body.data.user.suspendedReason).toBe("تخلف مکرر");
    expect(detail.body.data.user.accountActive).toBe(false);

    // The suspended user can no longer make authenticated requests.
    const blocked = await api().get("/me/state").set(...auth(customer.token));
    expect(blocked.status).toBe(403);

    // Re-activate clears the reason and restores access.
    const restore = await api()
      .patch(`/admin/users/${customer.id}/status`)
      .set(...auth(admin.token))
      .send({ isActive: true });
    expect(restore.body.data.suspendedReason).toBeNull();
    const ok = await api().get("/me/state").set(...auth(customer.token));
    expect(ok.status).toBe(200);
  });

  it("advanced search finds a user by national code", async () => {
    const admin = await createAdmin();
    const customer = await createCustomer();
    const nc = (await api().get("/me/state").set(...auth(customer.token))).body.data.user
      .nationalCode as string;

    const res = await api()
      .get(`/admin/users?search=${nc}`)
      .set(...auth(admin.token));
    expect(res.body.data.items.some((u: any) => u.id === customer.id)).toBe(true);
  });

  it("user detail includes the user's reservations array", async () => {
    const admin = await createAdmin();
    const customer = await createCustomer();
    const detail = await api().get(`/admin/users/${customer.id}`).set(...auth(admin.token));
    expect(Array.isArray(detail.body.data.reservations)).toBe(true);
  });
});

describe("Admin — SMS delivery log", () => {
  it("lists SMS logs with event/success filters; non-admins are blocked", async () => {
    const admin = await createAdmin();
    await SmsLog.create([
      { recipientMasked: "0912***6789", event: "salon_invite", provider: "limosms", success: true, messageId: "m1" },
      { recipientMasked: "0913***0000", event: "reservation_created", provider: "limosms", success: false, error: "اعتبار ناکافی" },
    ]);

    const all = await api().get("/admin/sms-logs").set(...auth(admin.token));
    expect(all.status).toBe(200);
    expect(all.body.data.items.length).toBe(2);

    const failed = await api().get("/admin/sms-logs?success=false").set(...auth(admin.token));
    expect(failed.body.data.items).toHaveLength(1);
    expect(failed.body.data.items[0].error).toBe("اعتبار ناکافی");

    const invites = await api()
      .get("/admin/sms-logs?event=salon_invite")
      .set(...auth(admin.token));
    expect(invites.body.data.items).toHaveLength(1);
    expect(invites.body.data.items[0].messageId).toBe("m1");

    // Leak check: a normal user cannot read the SMS log.
    const user = await login();
    const denied = await api().get("/admin/sms-logs").set(...auth(user.token));
    expect(denied.status).toBe(403);
  });
});
