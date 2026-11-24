import {
  api,
  auth,
  createAdmin,
  createCustomer,
  createStylist,
  futureDate,
} from "./helpers";
import { Reservation } from "../src/models/Reservation";
import { StylistProfile } from "../src/models/StylistProfile";
import { StylistService } from "../src/models/StylistService";
import { User } from "../src/models/User";

/**
 * A 0%-refund policy: every cancellation is a 100% penalty, which — because it
 * exceeds the refund — becomes customer debt. 720h guarantees no band matches
 * for any realistically near-future booking.
 */
const HARSH_POLICY = {
  rules: [{ hoursBeforeStart: 720, refundPercent: 0 }],
  freeRescheduleCount: 2,
  reschedulePenaltyPercent: 5,
};

async function firstSlot(stylistId: string, serviceId: string, date: string) {
  const res = await api().get(
    `/stylists/${stylistId}/availability?date=${date}&serviceIds=${serviceId}`,
  );
  expect(res.status).toBe(200);
  expect(res.body.data.slots.length).toBeGreaterThan(0);
  return res.body.data.slots[0].startTime as string;
}

async function tryBook(token: string, stylistId: string, serviceId: string, date: string) {
  const startTime = await firstSlot(stylistId, serviceId, date);
  return api()
    .post("/reservations")
    .set(...auth(token))
    .send({ stylistId, serviceIds: [serviceId], date, startTime });
}

async function book(token: string, stylistId: string, serviceId: string, date: string) {
  const res = await tryBook(token, stylistId, serviceId, date);
  expect(res.status).toBe(201);
  return res.body.data.reservation as { id: string; deposit: { amount: number } };
}

/** 700k service → 140k deposit, above the default 100k debt-lock threshold. */
async function setupHarshStylist() {
  const stylist = await createStylist();
  await StylistService.updateOne(
    { stylistId: stylist.id, serviceId: stylist.serviceIds[0] },
    { $set: { price: 700_000 } },
  );
  await StylistProfile.updateOne(
    { userId: stylist.id },
    { $set: { cancellationPolicy: HARSH_POLICY } },
  );
  return stylist;
}

describe("Cancellation debt", () => {
  it("posts the customer's cancellation penalty as debt, auto-locks them, and blocks new bookings", async () => {
    const customer = await createCustomer();
    const stylist = await setupHarshStylist();
    const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDate(3));
    expect(r.deposit.amount).toBe(140_000);

    const cancel = await api()
      .post(`/reservations/${r.id}/cancel`)
      .set(...auth(customer.token));
    expect(cancel.status).toBe(200);

    // The penalty is the customer's liability, recorded on their user account.
    const user = await User.findById(customer.id).lean();
    expect(user?.debtBalance).toBe(140_000);
    expect(user?.isDebtLocked).toBe(true);
    expect(user?.debtLockedAt).toBeTruthy();

    // The reservation ledger has both the penalty and the derived debt entry.
    const doc = await Reservation.findById(r.id).lean();
    const adjustments = doc!.financialAdjustments;
    expect(adjustments.find((a) => a.type === "penalty_cancellation")?.amount).toBe(140_000);
    expect(adjustments.find((a) => a.type === "debt")?.amount).toBe(140_000);

    // A debt-locked customer can no longer create bookings.
    const blocked = await tryBook(customer.token, stylist.id, stylist.serviceIds[0], futureDate(5));
    expect(blocked.status).toBe(403);
    expect(blocked.body.error.code).toBe("DEBT_LOCKED");
  });

  it("does not create debt when a full refund covers the penalty", async () => {
    const customer = await createCustomer();
    const stylist = await createStylist();
    // System default: ≥24h before start → 100% refund, 0% penalty.
    const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDate(3));

    const cancel = await api()
      .post(`/reservations/${r.id}/cancel`)
      .set(...auth(customer.token));
    expect(cancel.status).toBe(200);

    const user = await User.findById(customer.id).lean();
    expect(user?.debtBalance).toBe(0);
    expect(user?.isDebtLocked).toBe(false);
    const doc = await Reservation.findById(r.id).lean();
    expect(doc!.financialAdjustments.some((a) => a.type === "debt")).toBe(false);
  });

  it("posts the same penalty debt when a stylist cancels", async () => {
    const customer = await createCustomer();
    const stylist = await setupHarshStylist();
    const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDate(3));

    const cancel = await api()
      .patch(`/stylist/reservations/${r.id}/cancel`)
      .set(...auth(stylist.token))
      .send({ reason: "test" });
    expect(cancel.status).toBe(200);

    const user = await User.findById(customer.id).lean();
    expect(user?.debtBalance).toBe(140_000);
    expect(user?.isDebtLocked).toBe(true);
  });

  it("posts the same penalty debt when an admin cancels", async () => {
    const customer = await createCustomer();
    const stylist = await setupHarshStylist();
    const admin = await createAdmin();
    const r = await book(customer.token, stylist.id, stylist.serviceIds[0], futureDate(3));

    const cancel = await api()
      .post(`/admin/reservations/${r.id}/cancel`)
      .set(...auth(admin.token))
      .send({ reason: "test" });
    expect(cancel.status).toBe(200);

    const user = await User.findById(customer.id).lean();
    expect(user?.debtBalance).toBe(140_000);
    expect(user?.isDebtLocked).toBe(true);
  });
});
