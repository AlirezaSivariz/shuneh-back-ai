import { Types } from "mongoose";
import { api, auth, createCustomer, createStylist, createAdmin } from "./helpers";
import { Reservation } from "../src/models/Reservation";

const IRAN_OFFSET_MINUTES = 3 * 60 + 30;

/**
 * Build the date/startTime/endTime triple whose pre('validate') hook computes a
 * given target UTC startAt. Iran wall-clock = target + offset; the model stores
 * `date` at the UTC midnight of that Iran calendar day. Returns model-ready
 * fields so an inserted reservation lands exactly at `startAtTarget`.
 */
function fieldsForStartAt(startAtTarget: Date, durationMin: number) {
  const wall = new Date(startAtTarget.getTime() + IRAN_OFFSET_MINUTES * 60_000);
  const yyyy = wall.getUTCFullYear();
  const mm = String(wall.getUTCMonth() + 1).padStart(2, "0");
  const dd = String(wall.getUTCDate()).padStart(2, "0");
  const date = new Date(`${yyyy}-${mm}-${dd}T00:00:00.000Z`);
  const startTime = `${String(wall.getUTCHours()).padStart(2, "0")}:${String(
    wall.getUTCMinutes(),
  ).padStart(2, "0")}`;
  const endTotal = wall.getUTCHours() * 60 + wall.getUTCMinutes() + durationMin;
  const endTime = `${String(Math.floor(endTotal / 60)).padStart(2, "0")}:${String(
    endTotal % 60,
  ).padStart(2, "0")}`;
  return { date, startTime, endTime };
}

/** Book the first available slot for a stylist/service on a date → reservation DTO. */
async function book(
  customerToken: string,
  stylistId: string,
  serviceId: string,
  date: string,
) {
  const avail = await api()
    .get(`/stylists/${stylistId}/availability`)
    .query({ date, serviceIds: serviceId })
    .set(...auth(customerToken));
  expect(avail.status).toBe(200);
  const slots = avail.body.data.slots as Array<{ startTime: string }>;
  expect(slots.length).toBeGreaterThan(0);
  const startTime = slots[0].startTime;

  const res = await api()
    .post("/reservations")
    .set(...auth(customerToken))
    .send({ stylistId, serviceIds: [serviceId], date, startTime });
  expect(res.status).toBe(201);
  expect(res.body.data.reservation.status).toBe("confirmed");
  return res.body.data.reservation as {
    id: string;
    status: string;
    startTime: string;
    date: string;
  };
}

/** A future Iran calendar day "YYYY-MM-DD" that is N days out (deterministic). */
function futureDay(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

describe("reservation lifecycle", () => {
  describe("customer cancel", () => {
    it("cancels a future confirmed reservation", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();
      const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      const res = await api()
        .post(`/reservations/${r.id}/cancel`)
        .set(...auth(customer.token));
      expect(res.status).toBe(200);
      expect(res.body.data.reservation.status).toBe("cancelled");
    });

    it("rejects cancelling < 2h before start with CANCEL_TOO_LATE", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();

      // Insert a confirmed reservation starting ~1h from now (inside the 2h window).
      const startAt = new Date(Date.now() + 60 * 60 * 1000);
      const f = fieldsForStartAt(startAt, 30);
      const doc = await Reservation.create({
        customerId: new Types.ObjectId(customer.id),
        stylistId: new Types.ObjectId(stylist.id),
        salonId: new Types.ObjectId(stylist.salonId),
        serviceId: new Types.ObjectId(stylist.serviceIds[0]),
        serviceIds: [new Types.ObjectId(stylist.serviceIds[0])],
        items: [
          { serviceId: new Types.ObjectId(stylist.serviceIds[0]), price: 100000, durationMin: 30 },
        ],
        date: f.date,
        startTime: f.startTime,
        endTime: f.endTime,
        price: 100000,
        status: "confirmed",
      });

      const res = await api()
        .post(`/reservations/${doc._id}/cancel`)
        .set(...auth(customer.token));
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("CANCEL_TOO_LATE");
    });

    it("forbids cancelling another customer's reservation (403)", async () => {
      const owner = await createCustomer();
      const intruder = await createCustomer();
      const stylist = await createStylist();
      const r = await book(owner.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      const res = await api()
        .post(`/reservations/${r.id}/cancel`)
        .set(...auth(intruder.token));
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("stylist cancel", () => {
    it("lets the owning stylist cancel (cancelledBy stylist)", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();
      const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      const res = await api()
        .patch(`/stylist/reservations/${r.id}/cancel`)
        .set(...auth(stylist.token))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.reservation.status).toBe("cancelled");
      expect(res.body.data.reservation.cancelledBy).toBe("stylist");
    });

    it("forbids a different stylist from cancelling", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();
      const otherStylist = await createStylist();
      const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      const res = await api()
        .patch(`/stylist/reservations/${r.id}/cancel`)
        .set(...auth(otherStylist.token))
        .send({});
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("admin cancel", () => {
    it("lets an admin cancel (cancelledBy admin)", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();
      const admin = await createAdmin();
      const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      const res = await api()
        .post(`/admin/reservations/${r.id}/cancel`)
        .set(...auth(admin.token))
        .send({});
      expect(res.status).toBe(200);
      expect(res.body.data.reservation.status).toBe("cancelled");
      expect(res.body.data.reservation.cancelledBy).toBe("admin");
    });
  });

  describe("reschedule", () => {
    it("customer reschedules → new date/time + history by:customer", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();
      const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      const newDate = futureDay(5);
      // Find a free slot on the new day.
      const avail = await api()
        .get(`/stylists/${stylist.id}/availability`)
        .query({ date: newDate, serviceIds: stylist.serviceIds[0] })
        .set(...auth(customer.token));
      const newStart = avail.body.data.slots[0].startTime as string;

      const res = await api()
        .patch(`/reservations/${r.id}/reschedule`)
        .set(...auth(customer.token))
        .send({ date: newDate, startTime: newStart });
      expect(res.status).toBe(200);
      expect(res.body.data.reservation.date).toBe(newDate);
      expect(res.body.data.reservation.startTime).toBe(newStart);
      expect(res.body.data.reservation.rescheduleHistory).toHaveLength(1);
      expect(res.body.data.reservation.rescheduleHistory[0].by).toBe("customer");
    });

    it("stylist reschedules → history by:stylist", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();
      const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      const newDate = futureDay(6);
      const avail = await api()
        .get(`/stylists/${stylist.id}/availability`)
        .query({ date: newDate, serviceIds: stylist.serviceIds[0] })
        .set(...auth(customer.token));
      const newStart = avail.body.data.slots[0].startTime as string;

      const res = await api()
        .patch(`/stylist/reservations/${r.id}/reschedule`)
        .set(...auth(stylist.token))
        .send({ date: newDate, startTime: newStart });
      expect(res.status).toBe(200);
      expect(res.body.data.reservation.rescheduleHistory).toHaveLength(1);
      expect(res.body.data.reservation.rescheduleHistory[0].by).toBe("stylist");
    });

    it("rejects rescheduling onto a slot taken by another reservation (409 SLOT_TAKEN)", async () => {
      const c1 = await createCustomer();
      const c2 = await createCustomer();
      const stylist = await createStylist();
      const day = futureDay(4);

      // Two bookings on the same day at different (auto-picked) slots.
      const first = await book(c1.token, stylist.id, stylist.serviceIds[0], day);
      // Second booking: pick a slot that is NOT the first's startTime.
      const avail = await api()
        .get(`/stylists/${stylist.id}/availability`)
        .query({ date: day, serviceIds: stylist.serviceIds[0] })
        .set(...auth(c2.token));
      const otherSlot = (avail.body.data.slots as Array<{ startTime: string }>).find(
        (s) => s.startTime !== first.startTime,
      )!;
      const second = await api()
        .post("/reservations")
        .set(...auth(c2.token))
        .send({
          stylistId: stylist.id,
          serviceIds: [stylist.serviceIds[0]],
          date: day,
          startTime: otherSlot.startTime,
        });
      expect(second.status).toBe(201);

      // Reschedule the second onto the first's slot → conflict.
      const res = await api()
        .patch(`/reservations/${second.body.data.reservation.id}/reschedule`)
        .set(...auth(c2.token))
        .send({ date: first.date, startTime: first.startTime });
      expect(res.status).toBe(409);
      expect(res.body.error.code).toBe("SLOT_TAKEN");
    });

    it("rejects rescheduling a non-confirmed reservation (400 NOT_RESCHEDULABLE)", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();
      const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      // Cancel it first.
      await api().post(`/reservations/${r.id}/cancel`).set(...auth(customer.token));

      const newDate = futureDay(7);
      const avail = await api()
        .get(`/stylists/${stylist.id}/availability`)
        .query({ date: newDate, serviceIds: stylist.serviceIds[0] })
        .set(...auth(customer.token));
      const newStart = avail.body.data.slots[0].startTime as string;

      const res = await api()
        .patch(`/reservations/${r.id}/reschedule`)
        .set(...auth(customer.token))
        .send({ date: newDate, startTime: newStart });
      expect(res.status).toBe(400);
      expect(res.body.error.code).toBe("NOT_RESCHEDULABLE");
    });

    it("forbids a stranger (neither customer nor stylist) from rescheduling (403)", async () => {
      const customer = await createCustomer();
      const stranger = await createCustomer();
      const stylist = await createStylist();
      const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      const newDate = futureDay(8);
      const avail = await api()
        .get(`/stylists/${stylist.id}/availability`)
        .query({ date: newDate, serviceIds: stylist.serviceIds[0] })
        .set(...auth(customer.token));
      const newStart = avail.body.data.slots[0].startTime as string;

      const res = await api()
        .patch(`/reservations/${r.id}/reschedule`)
        .set(...auth(stranger.token))
        .send({ date: newDate, startTime: newStart });
      expect(res.status).toBe(403);
      expect(res.body.error.code).toBe("FORBIDDEN");
    });
  });

  describe("availability during reschedule (excludeReservationId)", () => {
    it("shows the reservation's own slot as free only when excluded", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();
      const day = futureDay(3);
      const r = await book(customer.token, stylist.id, stylist.serviceIds[0], day);

      // Without exclude: the booked slot is NOT offered.
      const without = await api()
        .get(`/stylists/${stylist.id}/availability`)
        .query({ date: day, serviceIds: stylist.serviceIds[0] })
        .set(...auth(customer.token));
      const withoutTimes = (without.body.data.slots as Array<{ startTime: string }>).map(
        (s) => s.startTime,
      );
      expect(withoutTimes).not.toContain(r.startTime);

      // With exclude: the reservation's own slot reappears as free.
      const withExclude = await api()
        .get(`/stylists/${stylist.id}/availability`)
        .query({ date: day, serviceIds: stylist.serviceIds[0], excludeReservationId: r.id })
        .set(...auth(customer.token));
      const withTimes = (withExclude.body.data.slots as Array<{ startTime: string }>).map(
        (s) => s.startTime,
      );
      expect(withTimes).toContain(r.startTime);
    });
  });

  describe("auto-complete (complete-due)", () => {
    it("completes past confirmed reservations and leaves future ones untouched", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();

      // PAST confirmed reservation (endAt ~2h ago).
      const pastStart = new Date(Date.now() - 3 * 60 * 60 * 1000);
      const pf = fieldsForStartAt(pastStart, 30);
      const past = await Reservation.create({
        customerId: new Types.ObjectId(customer.id),
        stylistId: new Types.ObjectId(stylist.id),
        salonId: new Types.ObjectId(stylist.salonId),
        serviceId: new Types.ObjectId(stylist.serviceIds[0]),
        serviceIds: [new Types.ObjectId(stylist.serviceIds[0])],
        items: [
          { serviceId: new Types.ObjectId(stylist.serviceIds[0]), price: 100000, durationMin: 30 },
        ],
        date: pf.date,
        startTime: pf.startTime,
        endTime: pf.endTime,
        price: 100000,
        status: "confirmed",
      });
      expect(past.endAt.getTime()).toBeLessThan(Date.now());

      // FUTURE confirmed reservation via the normal flow.
      const future = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      const res = await api().post("/internal/reservations/complete-due");
      expect(res.status).toBe(200);

      // The status flip is synchronous; the notify/flag pass is fire-and-forget
      // (`void (async () => …)()` in completeDueReservations), so poll for it.
      let pastAfter = await Reservation.findById(past._id).lean();
      for (let i = 0; i < 50 && !pastAfter!.completionNotifiedAt; i++) {
        await new Promise((r) => setTimeout(r, 20));
        pastAfter = await Reservation.findById(past._id).lean();
      }
      const futureAfter = await Reservation.findById(future.id).lean();
      expect(pastAfter!.status).toBe("completed");
      expect(pastAfter!.completionNotifiedAt).toBeTruthy();
      expect(futureAfter!.status).toBe("confirmed");
    });
  });

  describe("leave-salon effect on reservations", () => {
    it("refuses (409) with affectedReservations, then force-cancels", async () => {
      const customer = await createCustomer();
      const stylist = await createStylist();
      const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDay(3));

      // No force → 409 with the affected reservation listed.
      const blocked = await api()
        .delete(`/stylist/salons/${stylist.salonId}`)
        .set(...auth(stylist.token));
      expect(blocked.status).toBe(409);
      expect(blocked.body.error.code).toBe("SALON_HAS_ACTIVE_RESERVATIONS");
      const affected = blocked.body.error.details.affectedReservations as Array<{ id: string }>;
      expect(affected.map((a) => a.id)).toContain(r.id);

      // Force → 200; the reservation is cancelled by the stylist.
      const forced = await api()
        .delete(`/stylist/salons/${stylist.salonId}`)
        .query({ force: "true" })
        .set(...auth(stylist.token));
      expect(forced.status).toBe(200);

      const after = await Reservation.findById(r.id).lean();
      expect(after!.status).toBe("cancelled");
      expect(after!.cancelledBy).toBe("stylist");
      expect(after!.cancelReason).toBe("stylist_left_salon");

      // Membership + working hours removed → no slots offered anymore.
      const avail = await api()
        .get(`/stylists/${stylist.id}/availability`)
        .query({ date: futureDay(4), serviceIds: stylist.serviceIds[0] })
        .set(...auth(customer.token));
      expect(avail.body.data.slots).toHaveLength(0);
    });
  });
});
