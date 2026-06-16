import { api, auth, createStylist, createCustomer, futureDate } from "./helpers";
import { StylistSalon } from "../src/models/StylistSalon";
import { StylistProfile } from "../src/models/StylistProfile";

/**
 * A stylist is bookable (shown in search, has availability, can be booked) ONLY
 * with an active workplace (active membership in an active salon, or freelance)
 * AND with reservations turned on. createStylist() yields a bookable stylist
 * (own active salon); the tests then break that workplace and assert the effect.
 */
describe("Stylist bookability", () => {
  it("a stylist with an active salon is bookable: shown in search + has availability", async () => {
    const s = await createStylist();

    const search = await api().get("/stylists/search");
    expect(search.status).toBe(200);
    expect(search.body.data.stylists.some((x: { id: string }) => x.id === s.id)).toBe(true);

    const date = futureDate(3);
    const avail = await api().get(
      `/stylists/${s.id}/availability?date=${date}&serviceIds=${s.serviceIds[0]}`,
    );
    expect(avail.body.data.slots.length).toBeGreaterThan(0);
  });

  it("a stylist whose only membership is PENDING is NOT bookable", async () => {
    const s = await createStylist();
    await StylistSalon.updateMany({ stylistId: s.id }, { status: "pending" });

    const search = await api().get("/stylists/search");
    expect(search.body.data.stylists.some((x: { id: string }) => x.id === s.id)).toBe(false);

    const date = futureDate(3);
    const avail = await api().get(
      `/stylists/${s.id}/availability?date=${date}&serviceIds=${s.serviceIds[0]}`,
    );
    expect(avail.body.data.slots).toEqual([]);

    // Direct booking is rejected server-side.
    const customer = await createCustomer();
    const res = await api()
      .post("/reservations")
      .set(...auth(customer.token))
      .send({ stylistId: s.id, serviceIds: [s.serviceIds[0]], date, startTime: "10:00" });
    expect(res.status).toBe(400);
    expect(["NO_ACTIVE_WORKPLACE", "SALON_NOT_ACTIVE"]).toContain(res.body.error.code);
  });

  it("a REJECTED stylist is not bookable and disappears from search", async () => {
    const s = await createStylist();
    await StylistSalon.updateMany({ stylistId: s.id }, { status: "rejected" });

    const search = await api().get("/stylists/search");
    expect(search.body.data.stylists.some((x: { id: string }) => x.id === s.id)).toBe(false);

    const date = futureDate(3);
    const avail = await api().get(
      `/stylists/${s.id}/availability?date=${date}&serviceIds=${s.serviceIds[0]}`,
    );
    expect(avail.body.data.slots).toEqual([]);
  });

  it("GET /me/state reports bookable + a structured reason as the workplace changes", async () => {
    const s = await createStylist();

    let st = await api().get("/me/state").set(...auth(s.token));
    expect(st.body.data.stylist.bookable).toBe(true);
    expect(st.body.data.stylist.bookableReason).toBeNull();

    await StylistSalon.updateMany({ stylistId: s.id }, { status: "pending" });
    st = await api().get("/me/state").set(...auth(s.token));
    expect(st.body.data.stylist.bookable).toBe(false);
    expect(st.body.data.stylist.bookableReason).toBe("pending_salons");

    await StylistSalon.updateMany({ stylistId: s.id }, { status: "rejected" });
    st = await api().get("/me/state").set(...auth(s.token));
    expect(st.body.data.stylist.bookable).toBe(false);
    expect(st.body.data.stylist.bookableReason).toBe("no_active_workplace");
  });

  it("turning OFF acceptance makes an otherwise-active stylist not bookable (not_accepting)", async () => {
    const s = await createStylist();
    await StylistProfile.updateOne({ userId: s.id }, { isAcceptingReservations: false });

    const st = await api().get("/me/state").set(...auth(s.token));
    expect(st.body.data.stylist.bookable).toBe(false);
    expect(st.body.data.stylist.bookableReason).toBe("not_accepting");

    const search = await api().get("/stylists/search");
    expect(search.body.data.stylists.some((x: { id: string }) => x.id === s.id)).toBe(false);
  });
});
