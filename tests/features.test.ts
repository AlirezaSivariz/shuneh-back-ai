import {
  api,
  auth,
  createCustomer,
  createStylist,
  createAdmin,
  futureDate,
  markCompleted,
} from "./helpers";
import { StylistProfile } from "../src/models/StylistProfile";
import { User } from "../src/models/User";

// ─────────────────────────── Booking helpers ───────────────────────────

/** First free slot's startTime for a (stylist, services, date). */
async function firstSlot(stylistId: string, serviceIds: string[], date: string): Promise<string> {
  const res = await api()
    .get(`/stylists/${stylistId}/availability`)
    .query({ date, serviceIds: serviceIds.join(",") });
  expect(res.status).toBe(200);
  const slots = res.body.data.slots as Array<{ startTime: string }>;
  expect(slots.length).toBeGreaterThan(0);
  return slots[0].startTime;
}

/** Book (auto-confirms) and return the reservation DTO. */
async function book(
  customerToken: string,
  stylistId: string,
  serviceIds: string[],
  date: string,
  extra: Record<string, unknown> = {},
) {
  const startTime = await firstSlot(stylistId, serviceIds, date);
  const res = await api()
    .post("/reservations")
    .set(...auth(customerToken))
    .send({ stylistId, serviceIds, date, startTime, ...extra });
  return res;
}

/** Book + mark completed; returns reservationId. */
async function bookCompleted(
  customerToken: string,
  stylistId: string,
  serviceIds: string[],
  date: string,
): Promise<string> {
  const res = await book(customerToken, stylistId, serviceIds, date);
  expect(res.status).toBe(201);
  const id = res.body.data.reservation.id as string;
  await markCompleted(id);
  return id;
}

// ───────────────────────────── 1) Reviews ─────────────────────────────

describe("Reviews", () => {
  it("customer reviews a completed reservation once; affects stylist rating; lists it", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const reservationId = await bookCompleted(
      customer.token,
      stylist.id,
      [stylist.serviceIds[0]],
      futureDate(3),
    );

    const res = await api()
      .post(`/reservations/${reservationId}/review`)
      .set(...auth(customer.token))
      .send({ rating: 4, comment: "خوب بود" });
    expect(res.status).toBe(201);
    expect(res.body.data.review.rating).toBe(4);

    // Aggregate rating updated on the public profile.
    const profile = await api().get(`/stylists/${stylist.id}`);
    expect(profile.body.data.stylist.rating).toBe(4);
    expect(profile.body.data.stylist.ratingCount).toBe(1);

    // Listed under the stylist's reviews.
    const list = await api().get(`/stylists/${stylist.id}/reviews`);
    expect(list.status).toBe(200);
    expect(list.body.data.total).toBe(1);
    expect(list.body.data.items[0].rating).toBe(4);
  });

  it("a second review for the same reservation conflicts (ALREADY_REVIEWED)", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const reservationId = await bookCompleted(
      customer.token,
      stylist.id,
      [stylist.serviceIds[0]],
      futureDate(3),
    );
    await api()
      .post(`/reservations/${reservationId}/review`)
      .set(...auth(customer.token))
      .send({ rating: 5 });
    const second = await api()
      .post(`/reservations/${reservationId}/review`)
      .set(...auth(customer.token))
      .send({ rating: 3 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("ALREADY_REVIEWED");
  });

  it("only the reservation's own customer may review (FORBIDDEN)", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const other = await createCustomer();
    const reservationId = await bookCompleted(
      customer.token,
      stylist.id,
      [stylist.serviceIds[0]],
      futureDate(3),
    );
    const res = await api()
      .post(`/reservations/${reservationId}/review`)
      .set(...auth(other.token))
      .send({ rating: 5 });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("FORBIDDEN");
  });

  it("reviewing a non-completed reservation fails (400 RESERVATION_NOT_COMPLETED)", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const booked = await book(customer.token, stylist.id, [stylist.serviceIds[0]], futureDate(3));
    expect(booked.status).toBe(201); // confirmed, NOT completed
    const res = await api()
      .post(`/reservations/${booked.body.data.reservation.id}/review`)
      .set(...auth(customer.token))
      .send({ rating: 5 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("RESERVATION_NOT_COMPLETED");
  });
});

// ─────────────────────────── 2) Quick-rebook ───────────────────────────

describe("Quick-rebook", () => {
  it("a (stylist, service) completed >= 2 times appears with price/duration/timesUsed", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const svc = stylist.serviceIds[0];

    await bookCompleted(customer.token, stylist.id, [svc], futureDate(2));
    await bookCompleted(customer.token, stylist.id, [svc], futureDate(3));

    const res = await api()
      .get("/me/quick-rebook")
      .set(...auth(customer.token));
    expect(res.status).toBe(200);
    const suggestions = res.body.data.suggestions as Array<Record<string, unknown>>;
    const match = suggestions.find((s) => s.serviceId === svc && s.stylistId === stylist.id);
    expect(match).toBeDefined();
    expect(match!.timesUsed).toBe(2);
    expect(typeof match!.price).toBe("number");
    expect(typeof match!.durationMin).toBe("number");
  });

  it("a (stylist, service) completed only once does NOT appear", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const svc = stylist.serviceIds[0];
    await bookCompleted(customer.token, stylist.id, [svc], futureDate(2));

    const res = await api()
      .get("/me/quick-rebook")
      .set(...auth(customer.token));
    expect(res.status).toBe(200);
    const suggestions = res.body.data.suggestions as Array<Record<string, unknown>>;
    expect(suggestions.find((s) => s.serviceId === svc)).toBeUndefined();
  });
});

// ─────────────────────────── 3) Discount ───────────────────────────

describe("Discount codes", () => {
  it("creates a code (stylist) and the customer can validate it", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const date = futureDate(3);
    const startTime = await firstSlot(stylist.id, [stylist.serviceIds[0]], date);

    const create = await api()
      .post("/stylist/discount-codes")
      .set(...auth(stylist.token))
      .send({ code: "SAVE10", type: "percentage", value: 10 });
    expect(create.status).toBe(201);
    expect(create.body.data.discountCode.code).toBe("SAVE10");

    const validate = await api()
      .post("/reservations/validate-discount")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, code: "SAVE10", serviceIds: [stylist.serviceIds[0]], date, startTime });
    expect(validate.status).toBe(200);
    expect(validate.body.data.valid).toBe(true);
    const { originalPrice, discountAmount, finalPrice } = validate.body.data;
    expect(discountAmount).toBe(Math.round(originalPrice * 0.1));
    expect(finalPrice).toBe(originalPrice - discountAmount);
  });

  it("appliesTo 'services' only discounts covered services", async () => {
    const stylist = await createStylist({ serviceCount: 2 });
    const customer = await createCustomer();
    const [svcA, svcB] = stylist.serviceIds;
    const date = futureDate(3);
    const startTime = await firstSlot(stylist.id, [svcA, svcB], date);

    // 50% off, but ONLY service A is covered.
    await api()
      .post("/stylist/discount-codes")
      .set(...auth(stylist.token))
      .send({ code: "HALFA", type: "percentage", value: 50, appliesTo: "services", serviceIds: [svcA] });

    const validate = await api()
      .post("/reservations/validate-discount")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, code: "HALFA", serviceIds: [svcA, svcB], date, startTime });
    expect(validate.status).toBe(200);
    expect(validate.body.data.eligibleServiceIds).toEqual([svcA]);
    // Discount must be < 50% of the whole order, because only A is eligible.
    const { originalPrice, discountAmount } = validate.body.data;
    expect(discountAmount).toBeLessThan(Math.round(originalPrice * 0.5));
    expect(discountAmount).toBeGreaterThan(0);
  });

  it("a code restricted to other weekdays is rejected (DISCOUNT_DAY_NOT_ALLOWED)", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const date = futureDate(3);
    const startTime = await firstSlot(stylist.id, [stylist.serviceIds[0]], date);
    const bookingDow = new Date(`${date}T00:00:00.000Z`).getUTCDay();
    const otherDays = [0, 1, 2, 3, 4, 5, 6].filter((d) => d !== bookingDow);

    await api()
      .post("/stylist/discount-codes")
      .set(...auth(stylist.token))
      .send({ code: "DAYONLY", type: "fixed", value: 1000, timeConstraints: { daysOfWeek: otherDays } });

    const validate = await api()
      .post("/reservations/validate-discount")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, code: "DAYONLY", serviceIds: [stylist.serviceIds[0]], date, startTime });
    expect(validate.status).toBe(400);
    expect(validate.body.error.code).toBe("DISCOUNT_DAY_NOT_ALLOWED");
  });

  it("applies a discount at booking time and stores finalPrice", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const date = futureDate(3);

    await api()
      .post("/stylist/discount-codes")
      .set(...auth(stylist.token))
      .send({ code: "BOOK20", type: "percentage", value: 20 });

    const res = await book(customer.token, stylist.id, [stylist.serviceIds[0]], date, {
      discountCode: "BOOK20",
    });
    expect(res.status).toBe(201);
    const dto = res.body.data.reservation;
    expect(dto.discount).not.toBeNull();
    expect(dto.discount.code).toBe("BOOK20");
    expect(dto.discount.finalPrice).toBe(
      dto.discount.originalPrice - dto.discount.amount,
    );
    expect(dto.discount.amount).toBe(Math.round(dto.discount.originalPrice * 0.2));
  });

  it("enforces usageLimit at apply time (DISCOUNT_LIMIT_REACHED)", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();

    await api()
      .post("/stylist/discount-codes")
      .set(...auth(stylist.token))
      .send({ code: "ONCE", type: "fixed", value: 1000, usageLimit: 1 });

    // First booking consumes the only allowed use.
    const first = await book(customer.token, stylist.id, [stylist.serviceIds[0]], futureDate(2), {
      discountCode: "ONCE",
    });
    expect(first.status).toBe(201);

    // Second booking (different day/slot) must be rejected at validate time.
    const date2 = futureDate(3);
    const startTime2 = await firstSlot(stylist.id, [stylist.serviceIds[0]], date2);
    const validate = await api()
      .post("/reservations/validate-discount")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, code: "ONCE", serviceIds: [stylist.serviceIds[0]], date: date2, startTime: startTime2 });
    expect(validate.status).toBe(400);
    expect(validate.body.error.code).toBe("DISCOUNT_LIMIT_REACHED");
  });

  it("an unknown code is rejected (INVALID_DISCOUNT_CODE)", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const date = futureDate(3);
    const startTime = await firstSlot(stylist.id, [stylist.serviceIds[0]], date);
    const res = await api()
      .post("/reservations/validate-discount")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, code: "NOPE", serviceIds: [stylist.serviceIds[0]], date, startTime });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("INVALID_DISCOUNT_CODE");
  });
});

// ─────────────────────────── 4) Tips ───────────────────────────

describe("Tips", () => {
  it("records a tip on a completed reservation once; shows up in stylist tips", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const reservationId = await bookCompleted(
      customer.token,
      stylist.id,
      [stylist.serviceIds[0]],
      futureDate(3),
    );

    const res = await api()
      .post(`/reservations/${reservationId}/tip`)
      .set(...auth(customer.token))
      .send({ amount: 50000 });
    expect(res.status).toBe(201);
    expect(res.body.data.tip.amount).toBe(50000);
    expect(res.body.data.tip.status).toBe("recorded");

    const tips = await api()
      .get("/stylist/tips")
      .set(...auth(stylist.token));
    expect(tips.status).toBe(200);
    expect(tips.body.data.total).toBe(50000);
    expect(tips.body.data.count).toBe(1);
    expect(tips.body.data.items[0].amount).toBe(50000);
  });

  it("a second tip on the same reservation conflicts (TIP_ALREADY_RECORDED)", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const reservationId = await bookCompleted(
      customer.token,
      stylist.id,
      [stylist.serviceIds[0]],
      futureDate(3),
    );
    await api()
      .post(`/reservations/${reservationId}/tip`)
      .set(...auth(customer.token))
      .send({ amount: 10000 });
    const second = await api()
      .post(`/reservations/${reservationId}/tip`)
      .set(...auth(customer.token))
      .send({ amount: 20000 });
    expect(second.status).toBe(409);
    expect(second.body.error.code).toBe("TIP_ALREADY_RECORDED");
  });

  it("tipping a non-completed reservation fails (400 NOT_COMPLETED)", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const booked = await book(customer.token, stylist.id, [stylist.serviceIds[0]], futureDate(3));
    const res = await api()
      .post(`/reservations/${booked.body.data.reservation.id}/tip`)
      .set(...auth(customer.token))
      .send({ amount: 10000 });
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NOT_COMPLETED");
  });

  it("a non-positive tip amount is rejected (validation)", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const reservationId = await bookCompleted(
      customer.token,
      stylist.id,
      [stylist.serviceIds[0]],
      futureDate(3),
    );
    const res = await api()
      .post(`/reservations/${reservationId}/tip`)
      .set(...auth(customer.token))
      .send({ amount: 0 });
    expect(res.status).toBe(400);
  });
});

// ─────────────────── 5) Accepting-reservations toggle ───────────────────

describe("Accepting-reservations toggle", () => {
  it("pausing excludes from search, empties availability, blocks booking; resuming restores it", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const date = futureDate(3);

    // Sanity: bookable & searchable while accepting.
    const startTime = await firstSlot(stylist.id, [stylist.serviceIds[0]], date);
    expect(startTime).toBeTruthy();

    // Pause.
    const pause = await api()
      .patch("/stylist/availability-status")
      .set(...auth(stylist.token))
      .send({ isAcceptingReservations: false });
    expect(pause.status).toBe(200);
    expect(pause.body.data.isAcceptingReservations).toBe(false);

    // Excluded from search.
    const search = await api().get("/stylists/search");
    expect(search.status).toBe(200);
    expect((search.body.data.stylists as Array<{ id: string }>).find((s) => s.id === stylist.id)).toBeUndefined();

    // Availability empty.
    const avail = await api()
      .get(`/stylists/${stylist.id}/availability`)
      .query({ date, serviceIds: stylist.serviceIds[0] });
    expect(avail.status).toBe(200);
    expect(avail.body.data.slots).toEqual([]);

    // Booking blocked.
    const blocked = await api()
      .post("/reservations")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime });
    expect(blocked.status).toBe(400);
    expect(blocked.body.error.code).toBe("NOT_ACCEPTING_RESERVATIONS");

    // Resume → bookable again.
    const resume = await api()
      .patch("/stylist/availability-status")
      .set(...auth(stylist.token))
      .send({ isAcceptingReservations: true });
    expect(resume.body.data.isAcceptingReservations).toBe(true);

    const again = await book(customer.token, stylist.id, [stylist.serviceIds[0]], date);
    expect(again.status).toBe(201);
  });
});

// ─────────────────── 6) Verification / blue tick ───────────────────

describe("Verification (blue tick)", () => {
  it("incomplete profile cannot submit (400 PROFILE_INCOMPLETE with details.missing)", async () => {
    const stylist = await createStylist();
    const res = await api()
      .post("/stylist/profile/submit-verification")
      .set(...auth(stylist.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("PROFILE_INCOMPLETE");
    expect(Array.isArray(res.body.error.details.missing)).toBe(true);
    expect(res.body.error.details.missing.length).toBeGreaterThan(0);
  });

  it("completing the profile lets it submit (pending), then admin verify flips isVerified", async () => {
    const stylist = await createStylist();
    const admin = await createAdmin();

    // Make the profile complete enough for submission.
    await StylistProfile.updateOne(
      { userId: stylist.id },
      { $set: { portfolio: ["k"], nationalCardFront: "k1", nationalCardBack: "k2" } },
    );
    await User.updateOne({ _id: stylist.id }, { $set: { profilePhoto: "pp" } });

    const submit = await api()
      .post("/stylist/profile/submit-verification")
      .set(...auth(stylist.token));
    expect(submit.status).toBe(200);
    expect(submit.body.data.verificationStatus).toBe("pending");

    // Admin verifies.
    const verify = await api()
      .post(`/admin/stylists/${stylist.id}/verify`)
      .set(...auth(admin.token));
    expect(verify.status).toBe(200);
    expect(verify.body.data.verification.isVerified).toBe(true);

    // Privacy: the sensitive national-ID images are deleted after verification,
    // and a marker records that the documents were reviewed + removed.
    const cleared = await StylistProfile.findOne({ userId: stylist.id }).lean();
    expect(cleared?.nationalCardFront).toBeNull();
    expect(cleared?.nationalCardBack).toBeNull();
    expect(cleared?.documentsDeletedAt).toBeTruthy();

    // Public profile reflects the blue tick.
    const profile = await api().get(`/stylists/${stylist.id}`);
    expect(profile.body.data.stylist.isVerified).toBe(true);

    // Search results carry isVerified.
    const search = await api().get("/stylists/search");
    const found = (search.body.data.stylists as Array<{ id: string; isVerified: boolean }>).find(
      (s) => s.id === stylist.id,
    );
    expect(found).toBeDefined();
    expect(found!.isVerified).toBe(true);
  });
});

// ─────────────────── 7) Promotion + search order ───────────────────

describe("Promotion and search ordering", () => {
  it("a promoted stylist sorts before non-promoted ones in search", async () => {
    const promoted = await createStylist();
    const plain = await createStylist();
    const admin = await createAdmin();

    const until = new Date(Date.now() + 7 * 86400000).toISOString();
    const promote = await api()
      .post(`/admin/stylists/${promoted.id}/promote`)
      .set(...auth(admin.token))
      .send({ until });
    expect(promote.status).toBe(200);

    const search = await api().get("/stylists/search");
    expect(search.status).toBe(200);
    const ids = (search.body.data.stylists as Array<{ id: string; isPromoted: boolean }>).map((s) => s.id);
    const iPromoted = ids.indexOf(promoted.id);
    const iPlain = ids.indexOf(plain.id);
    expect(iPromoted).toBeGreaterThanOrEqual(0);
    expect(iPlain).toBeGreaterThanOrEqual(0);
    expect(iPromoted).toBeLessThan(iPlain);

    const promotedEntry = (search.body.data.stylists as Array<{ id: string; isPromoted: boolean }>).find(
      (s) => s.id === promoted.id,
    );
    expect(promotedEntry!.isPromoted).toBe(true);
  });
});
