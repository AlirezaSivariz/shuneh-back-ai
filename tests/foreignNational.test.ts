import {
  api,
  auth,
  login,
  createAdmin,
  createStylist,
  createCustomer,
  futureDate,
} from "./helpers";
import { User } from "../src/models/User";

/** Register the logged-in user as a foreign-national with a 12-digit id. */
async function setForeignPersonal(token: string, foreignId: string) {
  return api()
    .patch("/me/personal")
    .set(...auth(token))
    .send({
      firstName: "اتباع",
      lastName: "کاربر",
      isForeignNational: true,
      foreignId,
      birthDate: "1990-01-01",
    });
}

describe("Foreign national — personal info", () => {
  it("accepts a 12-digit foreignId and enters the pending approval gate", async () => {
    const s = await login();
    const res = await setForeignPersonal(s.token, "100000000001");
    expect(res.status).toBe(200);

    const state = await api().get("/me/state").set(...auth(s.token));
    expect(state.body.data.user.isForeignNational).toBe(true);
    expect(state.body.data.user.foreignId).toBe("100000000001");
    expect(state.body.data.user.foreignApprovalStatus).toBe("pending");
    expect(state.body.data.hasPersonalInfo).toBe(true);
  });

  it("accepts a foreignId of any length/format (only non-empty + unique)", async () => {
    const s = await login();
    const res = await setForeignPersonal(s.token, "AB-12345"); // not 12 digits
    expect(res.status).toBe(200);
    const state = await api().get("/me/state").set(...auth(s.token));
    expect(state.body.data.user.foreignId).toBe("AB-12345");
    expect(state.body.data.user.foreignApprovalStatus).toBe("pending");
  });

  it("a pending foreign user is reported as NOT active (with reason) in /me/state", async () => {
    const s = await login();
    await setForeignPersonal(s.token, "100000000099");
    const state = await api().get("/me/state").set(...auth(s.token));
    expect(state.body.data.isActive).toBe(false);
    expect(state.body.data.inactiveReason).toBe("pending_foreign_approval");
  });

  it("rejects a duplicate foreignId", async () => {
    const a = await login();
    await setForeignPersonal(a.token, "100000000002");
    const b = await login();
    const res = await setForeignPersonal(b.token, "100000000002");
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("FOREIGN_ID_TAKEN");
  });

  it("rejects sending both a nationalCode and foreign flag", async () => {
    const s = await login();
    const res = await api()
      .patch("/me/personal")
      .set(...auth(s.token))
      .send({
        firstName: "x",
        lastName: "y",
        isForeignNational: true,
        foreignId: "100000000003",
        nationalCode: "0012345678",
        birthDate: "1990-01-01",
      });
    expect(res.status).toBe(400);
  });
});

describe("Foreign national — booking gate", () => {
  it("a pending foreign customer cannot book until an admin approves them", async () => {
    const stylist = await createStylist();
    const date = futureDate(3);

    // Foreign customer (pending).
    const c = await login();
    await setForeignPersonal(c.token, "100000000010");
    await api().post("/onboarding/role").set(...auth(c.token)).send({ roles: ["customer"] });
    const customerId = (await api().get("/me/state").set(...auth(c.token))).body.data.user
      .id as string;

    const slot = (
      await api().get(
        `/stylists/${stylist.id}/availability?date=${date}&serviceIds=${stylist.serviceIds[0]}`,
      )
    ).body.data.slots[0];

    // Blocked while pending.
    const blocked = await api()
      .post("/reservations")
      .set(...auth(c.token))
      .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime: slot.startTime });
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("FOREIGN_NOT_APPROVED");

    // Admin approves.
    const admin = await createAdmin();
    const approve = await api()
      .post(`/admin/users/${customerId}/approve-foreign`)
      .set(...auth(admin.token));
    expect(approve.status).toBe(200);
    expect(approve.body.data.foreignApprovalStatus).toBe("approved");

    // Now the booking succeeds.
    const ok = await api()
      .post("/reservations")
      .set(...auth(c.token))
      .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime: slot.startTime });
    expect(ok.status).toBe(201);
  });
});

describe("Foreign national — stylist visibility", () => {
  it("a pending foreign stylist is hidden from search and unbookable until approved", async () => {
    const stylist = await createStylist();

    // Visible initially.
    const before = await api().get("/stylists/search");
    expect(before.body.data.stylists.some((x: any) => x.id === stylist.id)).toBe(true);

    // Flip the stylist's user to a pending foreign national.
    await User.updateOne(
      { _id: stylist.id },
      { $set: { isForeignNational: true, foreignApprovalStatus: "pending" } },
    );

    const hidden = await api().get("/stylists/search");
    expect(hidden.body.data.stylists.some((x: any) => x.id === stylist.id)).toBe(false);

    // Availability is empty while pending.
    const avail = await api().get(
      `/stylists/${stylist.id}/availability?date=${futureDate(3)}&serviceIds=${stylist.serviceIds[0]}`,
    );
    expect(avail.body.data.slots).toHaveLength(0);

    // Approve → visible + bookable again.
    const admin = await createAdmin();
    await api().post(`/admin/users/${stylist.id}/approve-foreign`).set(...auth(admin.token));

    const after = await api().get("/stylists/search");
    expect(after.body.data.stylists.some((x: any) => x.id === stylist.id)).toBe(true);
  });
});

describe("Foreign national — admin endpoints", () => {
  it("lists pending foreign users and supports reject-with-reason", async () => {
    const admin = await createAdmin();

    const c = await login();
    await setForeignPersonal(c.token, "100000000020");
    const id = (await api().get("/me/state").set(...auth(c.token))).body.data.user.id as string;

    const list = await api()
      .get("/admin/foreign-approvals?status=pending")
      .set(...auth(admin.token));
    expect(list.status).toBe(200);
    const row = list.body.data.items.find((u: any) => u.id === id);
    expect(row).toBeTruthy();
    expect(row.foreignId).toBe("100000000020");

    const reject = await api()
      .post(`/admin/users/${id}/reject-foreign`)
      .set(...auth(admin.token))
      .send({ reason: "مدارک ناقص" });
    expect(reject.status).toBe(200);
    expect(reject.body.data.foreignApprovalStatus).toBe("rejected");

    // The reason is surfaced back to the user.
    const state = await api().get("/me/state").set(...auth(c.token));
    expect(state.body.data.user.foreignApprovalStatus).toBe("rejected");
    expect(state.body.data.user.foreignRejectionReason).toBe("مدارک ناقص");
  });

  it("the admin users list reports a pending foreign user as not-active (not 'فعال')", async () => {
    const admin = await createAdmin();
    const c = await login();
    await setForeignPersonal(c.token, "100000000040");
    const id = (await api().get("/me/state").set(...auth(c.token))).body.data.user.id as string;

    const list = await api()
      .get(`/admin/users?search=${c.phone}`)
      .set(...auth(admin.token));
    const row = list.body.data.items.find((u: any) => u.id === id);
    expect(row).toBeTruthy();
    expect(row.foreignApprovalStatus).toBe("pending");
    expect(row.accountActive).toBe(false);

    // After approval the account becomes effectively active.
    await api().post(`/admin/users/${id}/approve-foreign`).set(...auth(admin.token));
    const state = await api().get("/me/state").set(...auth(c.token));
    expect(state.body.data.isActive).toBe(true);
    expect(state.body.data.inactiveReason).toBeNull();
  });

  it("a non-admin cannot approve foreign users", async () => {
    const customer = await createCustomer();
    const c = await login();
    await setForeignPersonal(c.token, "100000000030");
    const id = (await api().get("/me/state").set(...auth(c.token))).body.data.user.id as string;

    const res = await api()
      .post(`/admin/users/${id}/approve-foreign`)
      .set(...auth(customer.token));
    expect(res.status).toBe(403);
  });
});
