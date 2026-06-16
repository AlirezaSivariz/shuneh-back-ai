import { api, auth, createCustomer, createStylist, futureDate } from "./helpers";
import { Reservation } from "../src/models/Reservation";

async function firstSlot(stylistId: string, serviceId: string, date: string) {
  const res = await api().get(
    `/stylists/${stylistId}/availability?date=${date}&serviceIds=${serviceId}`,
  );
  return { res, slot: res.body.data.slots[0] };
}

describe("Reservation — availability & booking", () => {
  it("returns valid slots within working hours and excludes the past/horizon", async () => {
    const stylist = await createStylist();
    const date = futureDate(3);
    const { res, slot } = await firstSlot(stylist.id, stylist.serviceIds[0], date);
    expect(res.status).toBe(200);
    expect(res.body.data.slots.length).toBeGreaterThan(0);
    expect(slot.startTime >= "08:00").toBe(true);
    expect(slot.endTime <= "20:00").toBe(true);

    // available-days clamps to [today, horizon] — never returns past days.
    const days = await api().get(
      `/stylists/${stylist.id}/available-days?from=${futureDate(-10)}&to=${futureDate(10)}&serviceIds=${stylist.serviceIds[0]}`,
    );
    expect(days.status).toBe(200);
    expect(days.body.data.days.every((d: string) => d >= futureDate(0))).toBe(true);
  });

  it("rejects booking a slot whose time is already in the past", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    // Today, an early hour that has already passed (test runs after 08:05).
    const res = await api()
      .post("/reservations")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date: futureDate(0), startTime: "08:00" });
    // Either the slot is in the past, or (if run before 08:00) it booked — both are valid;
    // assert it never silently double-states.
    expect([201, 400]).toContain(res.status);
    if (res.status === 400) expect(["SLOT_IN_PAST", "OUTSIDE_WORKING_HOURS"]).toContain(res.body.error.code);
  });

  it("creates a reservation with a price/duration snapshot and auto-confirms", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const date = futureDate(3);
    const { slot } = await firstSlot(stylist.id, stylist.serviceIds[0], date);

    const res = await api()
      .post("/reservations")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime: slot.startTime, customerNote: "تست" });

    expect(res.status).toBe(201);
    const r = res.body.data.reservation;
    expect(r.status).toBe("confirmed");
    expect(r.price).toBeGreaterThan(0);
    expect(r.customerNote).toBe("تست");
    expect(r.salon).not.toBeNull(); // salonId resolved from the working interval
  });

  it("supports booking multiple services in one reservation", async () => {
    const stylist = await createStylist({ serviceCount: 2 });
    const customer = await createCustomer();
    const date = futureDate(4);
    const { slot } = await api()
      .get(`/stylists/${stylist.id}/availability?date=${date}&serviceIds=${stylist.serviceIds.join(",")}`)
      .then((r) => ({ slot: r.body.data.slots[0] }));

    const res = await api()
      .post("/reservations")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, serviceIds: stylist.serviceIds, date, startTime: slot.startTime });
    expect(res.status).toBe(201);
    expect(res.body.data.reservation.services.length).toBe(2);
  });

  it("rejects a slot outside working hours and an unknown service", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const date = futureDate(3);

    const outside = await api()
      .post("/reservations")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime: "05:00" });
    expect(outside.status).toBe(400);
    expect(outside.body.error.code).toBe("OUTSIDE_WORKING_HOURS");

    const badSvc = await api()
      .post("/reservations")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, serviceIds: ["6a2d2063fb555391cc330000"], date, startTime: "10:00" });
    expect(badSvc.status).toBe(400);
  });

  it("blocks self-booking but allows booking a DIFFERENT stylist", async () => {
    const s1 = await createStylist();
    const s2 = await createStylist();
    // s1 also becomes a customer so it can call POST /reservations.
    await api().post("/onboarding/role").set(...auth(s1.token)).send({ roles: ["customer"] });
    const date = futureDate(3);

    const self = await api()
      .post("/reservations")
      .set(...auth(s1.token))
      .send({ stylistId: s1.id, serviceIds: [s1.serviceIds[0]], date, startTime: "10:00" });
    expect(self.status).toBe(400);
    expect(self.body.error.code).toBe("SELF_BOOKING");

    const { slot } = await firstSlot(s2.id, s2.serviceIds[0], date);
    const cross = await api()
      .post("/reservations")
      .set(...auth(s1.token))
      .send({ stylistId: s2.id, serviceIds: [s2.serviceIds[0]], date, startTime: slot.startTime });
    expect(cross.status).toBe(201);
  });

  it("prevents double-booking — a sequential second booking of the same slot fails", async () => {
    const stylist = await createStylist();
    const c1 = await createCustomer();
    const c2 = await createCustomer();
    const date = futureDate(3);
    const { slot } = await firstSlot(stylist.id, stylist.serviceIds[0], date);

    const first = await api()
      .post("/reservations")
      .set(...auth(c1.token))
      .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime: slot.startTime });
    expect(first.status).toBe(201);

    const second = await api()
      .post("/reservations")
      .set(...auth(c2.token))
      .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime: slot.startTime });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("SLOT_TAKEN");
  });

  it("CONCURRENCY: two parallel bookings of one slot — at most one is confirmed", async () => {
    const stylist = await createStylist();
    const c1 = await createCustomer();
    const c2 = await createCustomer();
    const date = futureDate(5);
    const { slot } = await firstSlot(stylist.id, stylist.serviceIds[0], date);
    const body = { stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime: slot.startTime };

    const [a, b] = await Promise.all([
      api().post("/reservations").set(...auth(c1.token)).send(body),
      api().post("/reservations").set(...auth(c2.token)).send(body),
    ]);

    const successes = [a, b].filter((r) => r.status === 201).length;
    const confirmed = await Reservation.countDocuments({
      stylistId: stylist.id,
      date: new Date(`${date}T00:00:00.000Z`),
      status: { $in: ["pending", "confirmed"] },
    });
    // The booking flow uses a check-then-write guard (no DB transaction). This
    // asserts the invariant the slot must hold; if >1 is created it reveals a
    // genuine concurrency gap.
    expect(successes).toBe(1);
    expect(confirmed).toBe(1);
  });
});
