import {
  api,
  auth,
  createAdmin,
  createCustomer,
  createStylist,
  futureDate,
  markCompleted,
} from "./helpers";
import { Reservation } from "../src/models/Reservation";
import { StylistService } from "../src/models/StylistService";

async function firstSlot(stylistId: string, serviceId: string, date: string) {
  const res = await api().get(
    `/stylists/${stylistId}/availability?date=${date}&serviceIds=${serviceId}`,
  );
  expect(res.status).toBe(200);
  expect(res.body.data.slots.length).toBeGreaterThan(0);
  return res.body.data.slots[0].startTime as string;
}

async function book(
  token: string,
  stylistId: string,
  serviceId: string,
  date: string,
) {
  const startTime = await firstSlot(stylistId, serviceId, date);
  const res = await api()
    .post("/reservations")
    .set(...auth(token))
    .send({ stylistId, serviceIds: [serviceId], date, startTime });
  expect(res.status).toBe(201);
  return res.body.data.reservation;
}

async function balanceOf(token: string) {
  const res = await api()
    .get("/stylist/settlements/balance")
    .set(...auth(token));
  expect(res.status).toBe(200);
  return res.body.data;
}

async function rowsOf(token: string) {
  const res = await api()
    .get("/stylist/settlements/available-reservations")
    .set(...auth(token));
  expect(res.status).toBe(200);
  return res.body.data.items as Array<{ id: string; netAmount: number }>;
}

describe("Settlement balance consistency", () => {
  it("keeps available balance in sync with settleable reservation payouts", async () => {
    const admin = await createAdmin();
    const stylist = await createStylist();
    const customer = await createCustomer();
    await StylistService.updateOne(
      { stylistId: stylist.id, serviceId: stylist.serviceIds[0] },
      { $set: { price: 700_000 } },
    );

    // A performed booking: the stylist earns the whole deposit.
    const completed = await book(
      customer.token,
      stylist.id,
      stylist.serviceIds[0],
      futureDate(3),
    );
    await markCompleted(completed.id);
    await Reservation.updateOne(
      { _id: completed.id },
      { $set: { paymentStatus: "paid" } },
    );

    // A policy-cancelled booking: partial refund reduces the stylist payout,
    // while the cancellation penalty is the customer's debt, NOT stylist income.
    const cancelled = await book(
      customer.token,
      stylist.id,
      stylist.serviceIds[0],
      futureDate(4),
    );
    await Reservation.updateOne(
      { _id: cancelled.id },
      {
        $set: {
          status: "cancelled",
          paymentStatus: "paid",
          cancelledAt: new Date(),
        },
        $push: {
          financialAdjustments: {
            $each: [
              {
                type: "refund",
                label: "بازگشت جزئی",
                amount: 5_000,
                direction: "credit",
                status: "applied",
                reason: "test",
                createdAt: new Date(),
              },
              {
                type: "penalty_cancellation",
                label: "جریمه لغو",
                amount: 10_000,
                direction: "debit",
                status: "applied",
                reason: "test",
                createdAt: new Date(),
              },
            ],
          },
        },
      },
    );

    const rows = await rowsOf(stylist.token);
    expect(rows).toHaveLength(2);
    const completedRow = rows.find((r) => r.id === completed.id)!;
    const cancelledRow = rows.find((r) => r.id === cancelled.id)!;
    expect(completedRow.netAmount).toBe(completed.deposit.amount);
    expect(cancelledRow.netAmount).toBe(cancelled.deposit.amount - 5_000);

    const balance = await balanceOf(stylist.token);
    const expected = rows.reduce((sum, r) => sum + r.netAmount, 0);
    expect(balance.availableBalance).toBe(expected);
    // Penalties are reported for transparency but must not be paid to the stylist.
    expect(balance.totalCancelledPenalties).toBe(10_000);

    // A pending request must reduce availability by exactly its amount.
    const request = await api()
      .post("/stylist/settlements")
      .set(...auth(stylist.token))
      .send({ depositReservationIds: [completed.id] });
    expect(request.status).toBe(201);
    expect(request.body.data.amount).toBe(completedRow.netAmount);

    const afterRequest = await balanceOf(stylist.token);
    expect(afterRequest.pendingAmount).toBe(completedRow.netAmount);
    expect(afterRequest.availableBalance).toBe(
      expected - completedRow.netAmount,
    );
    const remainingRows = await rowsOf(stylist.token);
    expect(remainingRows).toHaveLength(1);
    expect(afterRequest.availableBalance).toBe(
      remainingRows.reduce((sum, r) => sum + r.netAmount, 0),
    );

    // Paying the request must not make the same reservation withdrawable again.
    const paid = await api()
      .patch(`/admin/settlements/${request.body.data.id}`)
      .set(...auth(admin.token))
      .send({ status: "paid" });
    expect(paid.status).toBe(200);
    const afterPayment = await balanceOf(stylist.token);
    expect(afterPayment.pendingAmount).toBe(0);
    expect(afterPayment.availableBalance).toBe(
      remainingRows.reduce((sum, r) => sum + r.netAmount, 0),
    );
  });
});
