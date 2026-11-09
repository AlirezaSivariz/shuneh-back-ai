import {
  api,
  auth,
  createAdmin,
  createCustomer,
  createStylist,
  futureDate,
  markCompleted,
} from "./helpers";
import { Coupon } from "../src/models/Coupon";
import { CouponRedemption } from "../src/models/CouponRedemption";
import { Reservation } from "../src/models/Reservation";
import { calculateDeposit } from "../src/modules/finance/finance.service";

let couponSeq = 0;
const nextCode = () => `CPN${++couponSeq}`;

async function makeCoupon(
  adminToken: string,
  overrides: Record<string, unknown> = {},
) {
  const res = await api()
    .post("/admin/coupons")
    .set(...auth(adminToken))
    .send({
      code: nextCode(),
      campaign: "custom",
      type: "fixed",
      value: 30_000,
      minBookingAmount: 0,
      isActive: true,
      ...overrides,
    });
  expect(res.status).toBe(201);
  return res.body.data.coupon;
}

async function firstSlot(stylistId: string, serviceId: string, date: string) {
  const res = await api().get(
    `/stylists/${stylistId}/availability?date=${date}&serviceIds=${serviceId}`,
  );
  expect(res.status).toBe(200);
  expect(res.body.data.slots.length).toBeGreaterThan(0);
  return res.body.data.slots[0] as { startTime: string };
}

async function book(
  token: string,
  stylistId: string,
  serviceId: string,
  date: string,
  extra: Record<string, unknown> = {},
) {
  const slot = await firstSlot(stylistId, serviceId, date);
  return api()
    .post("/reservations")
    .set(...auth(token))
    .send({
      stylistId,
      serviceIds: [serviceId],
      date,
      startTime: slot.startTime,
      ...extra,
    });
}

describe("Platform coupons", () => {
  it("supports admin CRUD, duplicate rejection, status toggle and delete", async () => {
    const admin = await createAdmin();
    const created = await makeCoupon(admin.token, {
      code: "Welcome10",
      campaign: "first_booking",
      type: "percentage",
      value: 10,
      maxDiscountAmount: 50_000,
      perCustomerLimit: 1,
      newCustomersOnly: true,
    });
    expect(created.code).toBe("Welcome10");
    expect(created.usageCount).toBe(0);
    expect(created.stats.redemptions).toBe(0);

    // Codes are globally unique case-insensitively.
    const duplicate = await api()
      .post("/admin/coupons")
      .set(...auth(admin.token))
      .send({ code: "welcome10", campaign: "custom", type: "fixed", value: 10_000 });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("COUPON_DUPLICATE");

    const patched = await api()
      .patch(`/admin/coupons/${created.id}`)
      .set(...auth(admin.token))
      .send({ name: "کمپین رزرو اول", value: 15 });
    expect(patched.status).toBe(200);
    expect(patched.body.data.coupon.name).toBe("کمپین رزرو اول");
    expect(patched.body.data.coupon.value).toBe(15);

    const disabled = await api()
      .patch(`/admin/coupons/${created.id}/status`)
      .set(...auth(admin.token))
      .send({ isActive: false });
    expect(disabled.status).toBe(200);
    expect(disabled.body.data.coupon.isActive).toBe(false);

    const list = await api()
      .get("/admin/coupons?search=welcome")
      .set(...auth(admin.token));
    expect(list.status).toBe(200);
    expect(list.body.data.items).toHaveLength(1);
    expect(list.body.data.summary.totalCoupons).toBe(1);

    const removed = await api()
      .delete(`/admin/coupons/${created.id}`)
      .set(...auth(admin.token));
    expect(removed.status).toBe(200);
    expect(await Coupon.countDocuments()).toBe(0);
  });

  it("previews a coupon without consuming it and mirrors the booking math", async () => {
    const admin = await createAdmin();
    const stylist = await createStylist();
    const customer = await createCustomer();
    const coupon = await makeCoupon(admin.token, { value: 30_000 });
    const date = futureDate(3);
    const slot = await firstSlot(stylist.id, stylist.serviceIds[0], date);

    const preview = await api()
      .post("/reservations/validate-coupon")
      .set(...auth(customer.token))
      .send({
        code: coupon.code,
        stylistId: stylist.id,
        serviceIds: [stylist.serviceIds[0]],
        date,
        startTime: slot.startTime,
      });

    expect(preview.status).toBe(200);
    const p = preview.body.data;
    expect(p.valid).toBe(true);
    expect(p.discountAmount).toBe(30_000);
    expect(p.finalPrice).toBe(p.priceBeforeCoupon - p.discountAmount);
    expect(p.depositAmount).toBe(calculateDeposit(p.priceBeforeCoupon).depositAmount);
    expect(p.platformFundedAmount).toBe(p.discountAmount);
    expect(await CouponRedemption.countDocuments()).toBe(0);

    const stored = await Coupon.findById(coupon.id).lean();
    expect(stored?.usageCount).toBe(0);
  });

  it("applies the coupon on booking and exposes an immutable snapshot", async () => {
    const admin = await createAdmin();
    const stylist = await createStylist();
    const customer = await createCustomer();
    const coupon = await makeCoupon(admin.token, { value: 30_000 });
    const date = futureDate(3);

    const res = await book(customer.token, stylist.id, stylist.serviceIds[0], date, {
      couponCode: coupon.code,
    });
    expect(res.status).toBe(201);
    const r = res.body.data.reservation;

    expect(r.price).toBeGreaterThan(0);
    expect(r.coupon.code).toBe(coupon.code);
    expect(r.coupon.priceBeforeCoupon).toBe(r.price);
    expect(r.coupon.amount).toBe(30_000);
    expect(r.coupon.finalPrice).toBe(r.price - 30_000);
    expect(r.coupon.platformFundedAmount).toBe(30_000);
    expect(r.coupon.depositAmount).toBe(
      calculateDeposit(r.coupon.priceBeforeCoupon).depositAmount,
    );
    expect(r.deposit.amount).toBe(r.coupon.depositAmount);
    expect(r.deposit.payableOnSite).toBe(
      Math.max(0, r.coupon.finalPrice - r.coupon.depositAmount),
    );

    expect(await CouponRedemption.countDocuments({ reservationId: r.id })).toBe(1);
    // The reservation keeps the coupon final price at the top level as well.
    const reservation = await Reservation.findById(r.id).lean();
    expect(reservation?.finalPrice).toBe(r.coupon.finalPrice);
    const stored = await Coupon.findById(coupon.id).lean();
    expect(stored?.usageCount).toBe(1);
  });

  it("never discounts below the pre-coupon deposit", async () => {
    const admin = await createAdmin();
    const stylist = await createStylist();
    const customer = await createCustomer();
    // 99% would strip far more than the deposit allows.
    const coupon = await makeCoupon(admin.token, {
      type: "percentage",
      value: 99,
      maxDiscountAmount: null,
    });
    const date = futureDate(3);

    const res = await book(customer.token, stylist.id, stylist.serviceIds[0], date, {
      couponCode: coupon.code,
    });
    expect(res.status).toBe(201);
    const r = res.body.data.reservation;
    expect(r.coupon.amount).toBe(
      Math.max(0, r.coupon.priceBeforeCoupon - r.coupon.depositAmount),
    );
    expect(r.coupon.finalPrice).toBeGreaterThanOrEqual(r.coupon.depositAmount);
  });

  it("enforces per-customer and global usage limits", async () => {
    const admin = await createAdmin();
    const stylist = await createStylist();
    const customer = await createCustomer();
    const other = await createCustomer();

    const perCustomer = await makeCoupon(admin.token, { perCustomerLimit: 1 });
    const first = await book(
      customer.token,
      stylist.id,
      stylist.serviceIds[0],
      futureDate(3),
      { couponCode: perCustomer.code },
    );
    expect(first.status).toBe(201);

    const second = await book(
      customer.token,
      stylist.id,
      stylist.serviceIds[0],
      futureDate(4),
      { couponCode: perCustomer.code },
    );
    expect(second.status).toBe(400);
    expect(second.body.error.code).toBe("COUPON_PER_CUSTOMER_LIMIT");

    const global = await makeCoupon(admin.token, { usageLimit: 1 });
    const g1 = await book(
      customer.token,
      stylist.id,
      stylist.serviceIds[0],
      futureDate(5),
      { couponCode: global.code },
    );
    expect(g1.status).toBe(201);
    const g2 = await book(
      other.token,
      stylist.id,
      stylist.serviceIds[0],
      futureDate(6),
      { couponCode: global.code },
    );
    expect(g2.status).toBe(400);
    expect(g2.body.error.code).toBe("COUPON_LIMIT_REACHED");
  });

  it("enforces new-customer-only and stylist/category restrictions", async () => {
    const admin = await createAdmin();
    const stylist = await createStylist();
    const otherStylist = await createStylist();
    const customer = await createCustomer();

    // Existing customer has a prior booking → new-customer coupon is rejected.
    const welcome = await makeCoupon(admin.token, { newCustomersOnly: true });
    const prior = await book(
      customer.token,
      stylist.id,
      stylist.serviceIds[0],
      futureDate(3),
    );
    expect(prior.status).toBe(201);
    const rejected = await book(
      customer.token,
      stylist.id,
      stylist.serviceIds[0],
      futureDate(4),
      { couponCode: welcome.code },
    );
    expect(rejected.status).toBe(400);
    expect(rejected.body.error.code).toBe("COUPON_NEW_CUSTOMERS_ONLY");

    // Coupon limited to a different specialist.
    const newCustomer = await createCustomer();
    const stylistOnly = await makeCoupon(admin.token, {
      stylistIds: [otherStylist.id],
    });
    const wrongStylist = await book(
      newCustomer.token,
      stylist.id,
      stylist.serviceIds[0],
      futureDate(5),
      { couponCode: stylistOnly.code },
    );
    expect(wrongStylist.status).toBe(400);
    expect(wrongStylist.body.error.code).toBe("COUPON_NOT_APPLICABLE");

    // Category restriction: allow a category that does NOT contain the booked service.
    const catalogue = (await api().get("/services")).body.data.categories as Array<{
      id: string;
      services: Array<{ id: string }>;
    }>;
    const bookedService = stylist.serviceIds[0];
    const bookedCategory = catalogue.find((c) =>
      c.services.some((s) => s.id === bookedService),
    );
    const otherCategory = catalogue.find((c) => c.id !== bookedCategory?.id);
    expect(otherCategory).toBeTruthy();
    const categoryOnly = await makeCoupon(admin.token, {
      categoryIds: [otherCategory!.id],
    });
    const customer3 = await createCustomer();
    const wrongCategory = await book(
      customer3.token,
      stylist.id,
      bookedService,
      futureDate(6),
      { couponCode: categoryOnly.code },
    );
    expect(wrongCategory.status).toBe(400);
    expect(wrongCategory.body.error.code).toBe("COUPON_NOT_APPLICABLE");
  });

  it("reimburses the platform-funded discount in specialist settlements", async () => {
    const admin = await createAdmin();
    const stylist = await createStylist();
    const customer = await createCustomer();
    const coupon = await makeCoupon(admin.token, { value: 30_000 });
    const date = futureDate(3);

    const res = await book(customer.token, stylist.id, stylist.serviceIds[0], date, {
      couponCode: coupon.code,
    });
    expect(res.status).toBe(201);
    const r = res.body.data.reservation;
    const funding = r.coupon.platformFundedAmount as number;

    await markCompleted(r.id);
    // Simulate a real paid booking so the balance aggregation includes it.
    await Reservation.updateOne({ _id: r.id }, { $set: { paymentStatus: "paid" } });

    const balance = await api()
      .get("/stylist/settlements/balance")
      .set(...auth(stylist.token));
    expect(balance.status).toBe(200);
    expect(balance.body.data.totalCouponFunding).toBe(funding);
    expect(balance.body.data.availableBalance).toBeGreaterThanOrEqual(funding);

    const settlable = await api()
      .get("/stylist/settlements/available-reservations")
      .set(...auth(stylist.token));
    expect(settlable.status).toBe(200);
    const row = settlable.body.data.items.find(
      (x: { id: string }) => x.id === r.id,
    );
    expect(row).toBeTruthy();
    expect(row.couponFunding).toBe(funding);
    expect(row.netAmount).toBe(r.deposit.amount + funding);
  });

  it("does not pay coupon funding on cancelled reservations", async () => {
    const admin = await createAdmin();
    const stylist = await createStylist();
    const customer = await createCustomer();
    const coupon = await makeCoupon(admin.token, { value: 30_000 });
    const date = futureDate(3);
    const res = await book(customer.token, stylist.id, stylist.serviceIds[0], date, {
      couponCode: coupon.code,
    });
    expect(res.status).toBe(201);
    const r = res.body.data.reservation;

    // Cancel, then force the document into the cancelled state the payout uses.
    await Reservation.updateOne(
      { _id: r.id },
      {
        $set: {
          status: "cancelled",
          paymentStatus: "paid",
          cancelledAt: new Date(),
        },
      },
    );
    // Cancellation without policy finance isn't settleable; add a partial-refund
    // policy adjustment so the payout path can be exercised.
    await Reservation.updateOne(
      { _id: r.id },
      {
        $push: {
          financialAdjustments: {
            type: "refund",
            label: "بازگشت جزئی",
            amount: 5_000,
            direction: "credit",
            status: "applied",
            reason: "test",
            createdAt: new Date(),
          },
        },
      },
    );

    const settlable = await api()
      .get("/stylist/settlements/available-reservations")
      .set(...auth(stylist.token));
    expect(settlable.status).toBe(200);
    const row = settlable.body.data.items.find(
      (x: { id: string }) => x.id === r.id,
    );
    expect(row).toBeTruthy();
    // Funding is only for completed bookings; a cancelled one must not include it.
    expect(row.couponFunding).toBe(0);
    expect(row.netAmount).toBe(r.deposit.amount - 5_000);
  });
});
