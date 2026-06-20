import { api, auth, createCustomer, createStylist, futureDate } from "./helpers";
import { Reservation } from "../src/models/Reservation";

/** Earliest available slot for a stylist/service on a date. */
async function firstSlot(stylistId: string, serviceId: string, date: string) {
  const res = await api().get(
    `/stylists/${stylistId}/availability?date=${date}&serviceIds=${serviceId}`,
  );
  return res.body.data.slots[0];
}

/** weekday (0..6, JS getUTCDay) of a YYYY-MM-DD Iran calendar day. */
function weekdayOf(date: string): number {
  return new Date(`${date}T00:00:00.000Z`).getUTCDay();
}

/** Book the earliest slot and return the created reservation + its date. */
async function bookEarliest(stylist: { id: string; serviceIds: string[] }) {
  const customer = await createCustomer();
  const date = futureDate(3);
  const slot = await firstSlot(stylist.id, stylist.serviceIds[0], date);
  expect(slot).toBeTruthy();
  const res = await api()
    .post("/reservations")
    .set(...auth(customer.token))
    .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime: slot.startTime });
  expect(res.status).toBe(201);
  return { reservation: res.body.data.reservation, date, slot };
}

function stylistState(token: string) {
  return api().get("/me/state").set(...auth(token));
}

describe("working-hours change → reconcile future reservations (no auto-cancel)", () => {
  it("a stylist narrowing their hours flags out-of-hours reservations without cancelling them", async () => {
    const stylist = await createStylist();
    const { reservation, date } = await bookEarliest(stylist);
    expect(reservation.startTime < "14:00").toBe(true);

    // Narrow this weekday's hours to 14:00–20:00 (still inside salon 08:00–20:00),
    // so the early-morning reservation now falls outside the working hours.
    const day = weekdayOf(date);
    const narrow = await api()
      .post("/stylist/working-hours")
      .set(...auth(stylist.token))
      .send({ entries: [{ salonId: stylist.salonId, dayOfWeek: day, start: "14:00", end: "20:00" }] });
    expect(narrow.status).toBe(200);

    // The reservation is NOT cancelled — the commitment stands.
    const stillThere = await Reservation.findById(reservation.id).lean();
    expect(stillThere?.status).toBe("confirmed");

    // The panel flag is raised…
    const state = await stylistState(stylist.token);
    expect(state.body.data.stylist.needsHoursUpdate).toBe(true);

    // …and the reservation is marked out-of-hours in the stylist's list.
    const list = await api()
      .get("/stylist/reservations?filter=upcoming")
      .set(...auth(stylist.token));
    const mine = list.body.data.reservations.find((r: any) => r.id === reservation.id);
    expect(mine.outOfHours).toBe(true);
  });

  it("restoring the hours clears the flag (idempotent reconcile)", async () => {
    const stylist = await createStylist();
    const { reservation, date } = await bookEarliest(stylist);
    const day = weekdayOf(date);

    await api()
      .post("/stylist/working-hours")
      .set(...auth(stylist.token))
      .send({ entries: [{ salonId: stylist.salonId, dayOfWeek: day, start: "14:00", end: "20:00" }] });
    expect((await stylistState(stylist.token)).body.data.stylist.needsHoursUpdate).toBe(true);

    // Re-open the full day → the reservation fits again → flag clears.
    await api()
      .post("/stylist/working-hours")
      .set(...auth(stylist.token))
      .send({ entries: [{ salonId: stylist.salonId, dayOfWeek: day, start: "08:00", end: "20:00" }] });

    const state = await stylistState(stylist.token);
    expect(state.body.data.stylist.needsHoursUpdate).toBe(false);

    const list = await api()
      .get("/stylist/reservations?filter=upcoming")
      .set(...auth(stylist.token));
    const mine = list.body.data.reservations.find((r: any) => r.id === reservation.id);
    expect(mine.outOfHours).toBe(false);
  });

  it("a SALON owner narrowing opening hours flags the stylist and hides out-of-hours slots", async () => {
    // The stylist created their own salon, so they are also its owner.
    const stylist = await createStylist();
    const { reservation, date } = await bookEarliest(stylist);
    const day = weekdayOf(date);

    // Owner narrows the salon to 14:00–20:00 for that weekday only.
    const patch = await api()
      .patch(`/owner/salons/${stylist.salonId}`)
      .set(...auth(stylist.token))
      .send({
        openingHours: [{ dayOfWeek: day, intervals: [{ start: "14:00", end: "20:00" }] }],
      });
    expect(patch.status).toBe(200);

    // Existing reservation untouched, but stylist is flagged.
    const stillThere = await Reservation.findById(reservation.id).lean();
    expect(stillThere?.status).toBe("confirmed");
    expect((await stylistState(stylist.token)).body.data.stylist.needsHoursUpdate).toBe(true);

    // Availability is re-validated against the new salon hours: no slot before 14:00.
    const avail = await api().get(
      `/stylists/${stylist.id}/availability?date=${date}&serviceIds=${stylist.serviceIds[0]}`,
    );
    const early = avail.body.data.slots.filter((s: any) => s.startTime < "14:00");
    expect(early).toHaveLength(0);
    // And the original early slot can no longer be booked.
    expect(reservation.startTime < "14:00").toBe(true);
  });
});
