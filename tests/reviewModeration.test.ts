import {
  api,
  auth,
  createAdmin,
  createCustomer,
  createStylist,
  futureDate,
  login,
  markCompleted,
} from "./helpers";

/** Book a completed reservation and leave a (pending) review; return review id. */
async function reviewAfterCompleted(
  stylist: { id: string; serviceIds: string[] },
  customerToken: string,
  rating: number,
  date: string,
): Promise<string> {
  const startTime = (
    await api().get(`/stylists/${stylist.id}/availability`).query({ date, serviceIds: stylist.serviceIds[0] })
  ).body.data.slots[0].startTime;
  const booked = await api()
    .post("/reservations")
    .set(...auth(customerToken))
    .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime });
  const id = booked.body.data.reservation.id as string;
  await markCompleted(id);
  const review = await api()
    .post(`/reservations/${id}/review`)
    .set(...auth(customerToken))
    .send({ rating });
  return review.body.data.review.id as string;
}

describe("Review moderation — admin", () => {
  it("reject-with-reason hides the review + the author sees the reason", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const admin = await createAdmin();
    const reviewId = await reviewAfterCompleted(stylist, customer.token, 5, futureDate(3));

    const reject = await api()
      .post(`/admin/reviews/${reviewId}/reject`)
      .set(...auth(admin.token))
      .send({ reason: "محتوای نامناسب" });
    expect(reject.status).toBe(200);
    expect(reject.body.data.status).toBe("rejected");

    // Not public; rating still zero.
    const profile = await api().get(`/stylists/${stylist.id}`);
    expect(profile.body.data.stylist.ratingCount).toBe(0);

    // Author sees their rejected review + reason.
    const mine = await api()
      .get(`/stylists/${stylist.id}/reviews`)
      .set(...auth(customer.token));
    expect(mine.body.data.myReview.status).toBe("rejected");
    expect(mine.body.data.myReview.rejectionReason).toBe("محتوای نامناسب");
  });

  it("a decision is always changeable (reject an approved review → removed from rating)", async () => {
    const stylist = await createStylist();
    const c1 = await createCustomer();
    const c2 = await createCustomer();
    const admin = await createAdmin();
    const r1 = await reviewAfterCompleted(stylist, c1.token, 4, futureDate(3));
    const r2 = await reviewAfterCompleted(stylist, c2.token, 2, futureDate(4));

    await api().post(`/admin/reviews/${r1}/approve`).set(...auth(admin.token));
    await api().post(`/admin/reviews/${r2}/approve`).set(...auth(admin.token));

    let profile = await api().get(`/stylists/${stylist.id}`);
    expect(profile.body.data.stylist.ratingCount).toBe(2);
    expect(profile.body.data.stylist.rating).toBe(3); // (4+2)/2

    // Re-reject one approved review → recomputed average excludes it.
    await api().post(`/admin/reviews/${r2}/reject`).set(...auth(admin.token)).send({});
    profile = await api().get(`/stylists/${stylist.id}`);
    expect(profile.body.data.stylist.ratingCount).toBe(1);
    expect(profile.body.data.stylist.rating).toBe(4);

    // …and re-approve a rejected review brings it back.
    await api().post(`/admin/reviews/${r2}/approve`).set(...auth(admin.token));
    profile = await api().get(`/stylists/${stylist.id}`);
    expect(profile.body.data.stylist.ratingCount).toBe(2);
  });

  it("status filters work and non-admins are blocked", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const admin = await createAdmin();
    const reviewId = await reviewAfterCompleted(stylist, customer.token, 5, futureDate(3));

    const pending = await api().get("/admin/reviews?status=pending").set(...auth(admin.token));
    expect(pending.body.data.items.some((r: any) => r.id === reviewId)).toBe(true);

    await api().post(`/admin/reviews/${reviewId}/approve`).set(...auth(admin.token));
    const approved = await api().get("/admin/reviews?status=approved").set(...auth(admin.token));
    expect(approved.body.data.items.some((r: any) => r.id === reviewId)).toBe(true);
    const stillPending = await api().get("/admin/reviews?status=pending").set(...auth(admin.token));
    expect(stillPending.body.data.items.some((r: any) => r.id === reviewId)).toBe(false);

    // Leak check.
    const user = await login();
    const denied = await api().get("/admin/reviews").set(...auth(user.token));
    expect(denied.status).toBe(403);
    const deniedAction = await api()
      .post(`/admin/reviews/${reviewId}/reject`)
      .set(...auth(user.token))
      .send({});
    expect(deniedAction.status).toBe(403);
  });
});
