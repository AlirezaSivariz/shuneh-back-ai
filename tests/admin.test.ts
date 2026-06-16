import {
  api,
  auth,
  login,
  createCustomer,
  createStylist,
  createAdmin,
  futureDate,
  markCompleted,
} from "./helpers";
import { Reservation } from "../src/models/Reservation";
import { AuditLog } from "../src/models/AuditLog";

/**
 * Book a slot for `customer` with `stylist` on a given date, returning the
 * created reservation (with id + price).
 */
async function book(
  stylist: { id: string; serviceIds: string[] },
  customerToken: string,
  date: string,
) {
  const avail = await api()
    .get(`/stylists/${stylist.id}/availability`)
    .query({ date, serviceIds: stylist.serviceIds.join(",") });
  expect(avail.status).toBe(200);
  const slots = avail.body.data.slots as Array<{ startTime: string }>;
  expect(slots.length).toBeGreaterThan(0);

  const res = await api()
    .post("/reservations")
    .set(...auth(customerToken))
    .send({
      stylistId: stylist.id,
      serviceIds: stylist.serviceIds,
      date,
      startTime: slots[0].startTime,
    });
  expect(res.status).toBe(201);
  return res.body.data.reservation as { id: string; price: number | null };
}

/**
 * Book + mark completed + force the reservation's `date` into a recent past day
 * (futureDate(-3)) so it falls inside a from=futureDate(-30)&to=futureDate(0)
 * report range. markCompleted only flips status, so we set the date separately.
 */
async function bookCompletedInPast(
  stylist: { id: string; serviceIds: string[] },
  customerToken: string,
) {
  // Book on a near-future day (a real bookable slot), then backdate it.
  const reservation = await book(stylist, customerToken, futureDate(2));
  await markCompleted(reservation.id);
  const pastDay = futureDate(-3);
  await Reservation.updateOne(
    { _id: reservation.id },
    { $set: { date: new Date(`${pastDay}T00:00:00.000Z`) } },
  );
  return reservation;
}

describe("Admin area", () => {
  // ─────────────────────────── 1) requireAdmin guard ───────────────────────────
  describe("requireAdmin guard", () => {
    const reads = [
      "/admin/reports",
      "/admin/users",
      "/admin/reservations",
      "/admin/salons",
      "/admin/stylists",
      "/admin/audit-logs",
      "/admin/verifications",
    ];

    it("rejects a customer token with 403 ADMIN_ONLY on every admin route", async () => {
      const customer = await createCustomer();
      for (const path of reads) {
        const res = await api()
          .get(path)
          .set(...auth(customer.token));
        expect(res.status).toBe(403);
        expect(res.body.error.code).toBe("ADMIN_ONLY");
      }
      // A representative write route too.
      const fakeId = "0".repeat(24);
      const write = await api()
        .post(`/admin/reservations/${fakeId}/cancel`)
        .set(...auth(customer.token))
        .send({});
      expect(write.status).toBe(403);
      expect(write.body.error.code).toBe("ADMIN_ONLY");
    });

    it("rejects no-token requests with 401 on every admin route", async () => {
      for (const path of reads) {
        const res = await api().get(path);
        expect(res.status).toBe(401);
      }
      const fakeId = "0".repeat(24);
      const write = await api().post(`/admin/reservations/${fakeId}/cancel`).send({});
      expect(write.status).toBe(401);
    });
  });

  // ─────────────────────────── 2) Global read views ───────────────────────────
  describe("global read views", () => {
    it("GET /admin/reports returns non-zero totals over seeded data", async () => {
      const admin = await createAdmin();
      const stylist = await createStylist();
      const customer = await createCustomer();
      await bookCompletedInPast(stylist, customer.token);

      const res = await api()
        .get("/admin/reports")
        .set(...auth(admin.token));
      expect(res.status).toBe(200);
      const t = res.body.data.totals;
      expect(t.users).toBeGreaterThan(0);
      expect(t.reservations).toBeGreaterThan(0);
      expect(t.grossRevenue).toBeGreaterThan(0);
      expect(t.salons).toBeGreaterThan(0);
      expect(t.stylists).toBeGreaterThan(0);
    });

    it("GET /admin/users is paginated and hides nationalCode in the list", async () => {
      const admin = await createAdmin();
      await createCustomer();
      const res = await api()
        .get("/admin/users")
        .query({ page: 1, limit: 50 })
        .set(...auth(admin.token));
      expect(res.status).toBe(200);
      const body = res.body.data;
      expect(Array.isArray(body.items)).toBe(true);
      expect(body.page).toBe(1);
      expect(typeof body.total).toBe("number");
      expect(typeof body.totalPages).toBe("number");
      expect(body.items.length).toBeGreaterThan(0);
      for (const u of body.items) {
        expect(u).not.toHaveProperty("nationalCode");
      }
    });

    it("GET /admin/users?role= filters by role", async () => {
      const admin = await createAdmin();
      await createStylist();
      const res = await api()
        .get("/admin/users")
        .query({ role: "stylist" })
        .set(...auth(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.data.items.length).toBeGreaterThan(0);
      for (const u of res.body.data.items) {
        expect(u.roles).toContain("stylist");
      }
    });

    it("GET /admin/users/:id detail DOES include nationalCode", async () => {
      const admin = await createAdmin();
      const customer = await createCustomer();
      const res = await api()
        .get(`/admin/users/${customer.id}`)
        .set(...auth(admin.token));
      expect(res.status).toBe(200);
      expect(res.body.data.user).toHaveProperty("nationalCode");
      expect(res.body.data.user.nationalCode).toBeTruthy();
    });

    it("GET /admin/reservations is paginated with enriched customer/stylist/services", async () => {
      const admin = await createAdmin();
      const stylist = await createStylist();
      const customer = await createCustomer();
      await book(stylist, customer.token, futureDate(2));

      const res = await api()
        .get("/admin/reservations")
        .set(...auth(admin.token));
      expect(res.status).toBe(200);
      const body = res.body.data;
      expect(body.items.length).toBeGreaterThan(0);
      expect(typeof body.totalPages).toBe("number");
      const row = body.items[0];
      expect(row.customer).toBeTruthy();
      expect(row.customer.id).toBeTruthy();
      expect(row.stylist).toBeTruthy();
      expect(Array.isArray(row.services)).toBe(true);
      expect(row.services.length).toBeGreaterThan(0);
      expect(row.services[0].name).toBeTruthy();
    });

    it("GET /admin/salons and /admin/stylists are paginated", async () => {
      const admin = await createAdmin();
      await createStylist();

      const salons = await api()
        .get("/admin/salons")
        .set(...auth(admin.token));
      expect(salons.status).toBe(200);
      expect(salons.body.data.items.length).toBeGreaterThan(0);
      expect(typeof salons.body.data.totalPages).toBe("number");

      const stylists = await api()
        .get("/admin/stylists")
        .set(...auth(admin.token));
      expect(stylists.status).toBe(200);
      expect(stylists.body.data.items.length).toBeGreaterThan(0);
      expect(typeof stylists.body.data.totalPages).toBe("number");
    });
  });

  // ──────────────────── 3) Write actions + AuditLog ────────────────────
  describe("write actions + audit log", () => {
    it("POST /admin/reservations/:id/cancel cancels + records cancelledBy admin + audit", async () => {
      const admin = await createAdmin();
      const stylist = await createStylist();
      const customer = await createCustomer();
      const reservation = await book(stylist, customer.token, futureDate(2));

      const before = await AuditLog.countDocuments();
      const res = await api()
        .post(`/admin/reservations/${reservation.id}/cancel`)
        .set(...auth(admin.token))
        .send({ reason: "test cancel" });
      expect(res.status).toBe(200);
      expect(res.body.data.reservation.status).toBe("cancelled");
      expect(res.body.data.reservation.cancelledBy).toBe("admin");

      const after = await AuditLog.countDocuments();
      expect(after).toBe(before + 1);

      // The audit-logs list reflects the recorded action.
      const logs = await api()
        .get("/admin/audit-logs")
        .set(...auth(admin.token));
      expect(logs.status).toBe(200);
      const actions = logs.body.data.items.map((i: { action: string }) => i.action);
      expect(actions).toContain("reservation.cancel");
    });

    it("PATCH /admin/users/:id/status {isActive:false} blocks the user (subsequent request → 403 ACCOUNT_DISABLED)", async () => {
      const admin = await createAdmin();
      const customer = await createCustomer();

      // Customer can act before being blocked.
      const ok = await api()
        .get("/me/state")
        .set(...auth(customer.token));
      expect(ok.status).toBe(200);

      const block = await api()
        .patch(`/admin/users/${customer.id}/status`)
        .set(...auth(admin.token))
        .send({ isActive: false });
      expect(block.status).toBe(200);
      expect(block.body.data.isActive).toBe(false);

      // The blocked user's authenticated request is now rejected.
      const blocked = await api()
        .get("/me/state")
        .set(...auth(customer.token));
      expect(blocked.status).toBe(403);
      expect(blocked.body.error.code).toBe("ACCOUNT_DISABLED");

      // And it produced an audit row.
      const logs = await api()
        .get("/admin/audit-logs")
        .set(...auth(admin.token));
      const actions = logs.body.data.items.map((i: { action: string }) => i.action);
      expect(actions).toContain("user.setStatus");
    });

    it("admin cannot disable THEMSELVES → 400 CANNOT_DISABLE_SELF", async () => {
      const admin = await createAdmin();
      const res = await api()
        .patch(`/admin/users/${admin.user.id}/status`)
        .set(...auth(admin.token))
        .send({ isActive: false });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CANNOT_DISABLE_SELF");
    });

    it("POST /admin/stylists/:id/promote and /unpromote update the profile + audit", async () => {
      const admin = await createAdmin();
      const stylist = await createStylist();

      const promote = await api()
        .post(`/admin/stylists/${stylist.id}/promote`)
        .set(...auth(admin.token))
        .send({ until: new Date(Date.now() + 7 * 86400000).toISOString() });
      expect(promote.status).toBe(200);
      expect(promote.body.data.promotion.isPromoted).toBe(true);

      const unpromote = await api()
        .post(`/admin/stylists/${stylist.id}/unpromote`)
        .set(...auth(admin.token))
        .send({});
      expect(unpromote.status).toBe(200);
      expect(unpromote.body.data.promotion.isPromoted).toBe(false);

      const logs = await api()
        .get("/admin/audit-logs")
        .query({ limit: 100 })
        .set(...auth(admin.token));
      const actions = logs.body.data.items.map((i: { action: string }) => i.action);
      expect(actions).toContain("stylist.promote");
      expect(actions).toContain("stylist.unpromote");
    });

    it("GET /admin/audit-logs is paginated and grows as writes happen", async () => {
      const admin = await createAdmin();
      const stylist = await createStylist();

      const before = await api()
        .get("/admin/audit-logs")
        .set(...auth(admin.token));
      expect(before.status).toBe(200);
      expect(typeof before.body.data.totalPages).toBe("number");
      const beforeTotal = before.body.data.total as number;

      await api()
        .post(`/admin/stylists/${stylist.id}/promote`)
        .set(...auth(admin.token))
        .send({ until: new Date(Date.now() + 7 * 86400000).toISOString() });

      const after = await api()
        .get("/admin/audit-logs")
        .set(...auth(admin.token));
      expect(after.body.data.total).toBe(beforeTotal + 1);
    });
  });

  // ──────────────────── 4) Stylist & customer reports ────────────────────
  describe("stylist & customer reports", () => {
    const from = futureDate(-30);
    const to = futureDate(0);

    it("GET /stylist/reports returns totals/byStatus/byService with correct values", async () => {
      const stylist = await createStylist();
      const customer = await createCustomer();
      const reservation = await bookCompletedInPast(stylist, customer.token);
      const price = reservation.price ?? 0;
      expect(price).toBeGreaterThan(0);

      const res = await api()
        .get("/stylist/reports")
        .query({ from, to })
        .set(...auth(stylist.token));
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(data.totals.reservations).toBe(1);
      expect(data.totals.grossIncome).toBe(price);
      expect(data.byStatus.completed).toBe(1);
      expect(Array.isArray(data.byService)).toBe(true);
      expect(data.byService.length).toBeGreaterThan(0);
      const serviceRevenue = data.byService.reduce(
        (s: number, r: { revenue: number }) => s + r.revenue,
        0,
      );
      expect(serviceRevenue).toBe(price);
    });

    it("GET /stylist/reports/analytics returns byService ranking + byDayOfWeek", async () => {
      const stylist = await createStylist();
      const customer = await createCustomer();
      await bookCompletedInPast(stylist, customer.token);

      const res = await api()
        .get("/stylist/reports/analytics")
        .query({ from, to })
        .set(...auth(stylist.token));
      expect(res.status).toBe(200);
      const data = res.body.data;
      expect(Array.isArray(data.byService)).toBe(true);
      expect(data.byService.length).toBeGreaterThan(0);
      expect(data.byService[0]).toHaveProperty("sharePercent");
      expect(Array.isArray(data.byDayOfWeek)).toBe(true);
      expect(data.byDayOfWeek.length).toBe(7);
      const totalDayCount = data.byDayOfWeek.reduce(
        (s: number, r: { count: number }) => s + r.count,
        0,
      );
      expect(totalDayCount).toBe(1);
    });

    it("GET /me/reports (customer) returns totals {reservations, totalSpent, upcoming}", async () => {
      const stylist = await createStylist();
      const customer = await createCustomer();
      const reservation = await bookCompletedInPast(stylist, customer.token);
      const price = reservation.price ?? 0;

      const res = await api()
        .get("/me/reports")
        .query({ from, to })
        .set(...auth(customer.token));
      expect(res.status).toBe(200);
      const totals = res.body.data.totals;
      expect(totals.reservations).toBe(1);
      expect(totals.totalSpent).toBe(price);
      expect(totals).toHaveProperty("upcoming");
      expect(typeof totals.upcoming).toBe("number");
    });
  });
});
