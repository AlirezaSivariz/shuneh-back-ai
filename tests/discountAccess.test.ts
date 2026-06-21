import { api, auth, createStylist, futureDate } from "./helpers";

/**
 * Regression: a multi-role user (here a stylist, who does NOT hold the
 * 'customer' role) used to get the raw English "Requires one of roles: customer"
 * when validating a discount before booking — because the whole reservation
 * router was gated on the 'customer' role, but that role is only granted at the
 * final booking step. Now any authenticated user may validate a discount.
 */
describe("Discount validation access (multi-role)", () => {
  it("a stylist (no customer role) is NOT rejected with a role error", async () => {
    const me = await createStylist(); // has 'stylist', not 'customer'
    const target = await createStylist(); // someone to book

    const res = await api()
      .post("/reservations/validate-discount")
      .set(...auth(me.token))
      .send({
        stylistId: target.id,
        code: "NONEXISTENT",
        serviceIds: [target.serviceIds[0]],
        date: futureDate(3),
        startTime: "10:00",
      });

    // NOT a 403 role error — it's a normal Persian discount error instead.
    expect(res.status).not.toBe(403);
    expect(res.body.error?.code).not.toBe("FORBIDDEN_ROLE");
    expect(res.body.error?.code).toBe("INVALID_DISCOUNT_CODE");
  });

  it("the role guard returns a Persian message (no raw English)", async () => {
    // Any admin-only route with a non-admin token exercises authorize().
    const me = await createStylist();
    const res = await api().get("/admin/users").set(...auth(me.token));
    expect(res.status).toBe(403);
    expect(res.body.error.message).not.toMatch(/[A-Za-z]{4,}/); // no English words
  });
});
