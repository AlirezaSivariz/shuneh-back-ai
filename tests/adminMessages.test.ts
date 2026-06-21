import sharp from "sharp";
import { api, auth, createAdmin, createCustomer, createStylist, login } from "./helpers";
import { StylistProfile } from "../src/models/StylistProfile";
import { Types } from "mongoose";

function samplePng(): Promise<Buffer> {
  return sharp({ create: { width: 80, height: 80, channels: 3, background: { r: 5, g: 5, b: 5 } } })
    .png()
    .toBuffer();
}

describe("Internal messages (admin → user)", () => {
  it("admin sends a message; the user sees it + unread count, then marks it read", async () => {
    const admin = await createAdmin();
    const customer = await createCustomer();

    const send = await api()
      .post("/admin/messages")
      .set(...auth(admin.token))
      .send({ recipientId: customer.id, title: "سلام", body: "این یک پیام آزمایشی است." });
    expect(send.status).toBe(201);

    const list = await api().get("/me/messages").set(...auth(customer.token));
    expect(list.body.data.unreadCount).toBe(1);
    expect(list.body.data.items[0].body).toBe("این یک پیام آزمایشی است.");
    const msgId = list.body.data.items[0].id;

    const unread = await api().get("/me/messages/unread-count").set(...auth(customer.token));
    expect(unread.body.data.count).toBe(1);

    await api().patch(`/me/messages/${msgId}/read`).set(...auth(customer.token));
    const after = await api().get("/me/messages/unread-count").set(...auth(customer.token));
    expect(after.body.data.count).toBe(0);
  });

  it("a user cannot read another user's message", async () => {
    const admin = await createAdmin();
    const a = await createCustomer();
    const b = await createCustomer();
    await api()
      .post("/admin/messages")
      .set(...auth(admin.token))
      .send({ recipientId: a.id, body: "محرمانه" });

    const aMsgId = (await api().get("/me/messages").set(...auth(a.token))).body.data.items[0].id;
    const res = await api().patch(`/me/messages/${aMsgId}/read`).set(...auth(b.token));
    expect(res.status).toBe(404);
  });

  it("templates are available to admins", async () => {
    const admin = await createAdmin();
    const res = await api().get("/admin/message-templates").set(...auth(admin.token));
    expect(res.status).toBe(200);
    expect(res.body.data.templates.length).toBeGreaterThan(0);
    expect(res.body.data.templates[0]).toHaveProperty("body");
  });

  it("non-admins cannot send messages or read templates", async () => {
    const user = await login();
    expect((await api().post("/admin/messages").set(...auth(user.token)).send({ recipientId: user.user.id, body: "x" })).status).toBe(403);
    expect((await api().get("/admin/message-templates").set(...auth(user.token))).status).toBe(403);
  });
});

describe("Admin image deletion", () => {
  it("deletes a user's profile photo + (optionally) messages them", async () => {
    const admin = await createAdmin();
    const customer = await createCustomer();
    const png = await samplePng();
    await api().post("/me/profile-photo").set(...auth(customer.token)).attach("photo", png, "p.png");

    const del = await api()
      .delete(`/admin/users/${customer.id}/profile-photo`)
      .set(...auth(admin.token))
      .send({ message: "عکس نامناسب بود." });
    expect(del.status).toBe(200);
    expect(del.body.data.profilePhoto).toBeNull();

    const state = await api().get("/me/state").set(...auth(customer.token));
    expect(state.body.data.user.profilePhoto).toBeNull();

    // The optional message reached the user.
    const msgs = await api().get("/me/messages").set(...auth(customer.token));
    expect(msgs.body.data.items.some((m: any) => m.body === "عکس نامناسب بود.")).toBe(true);
  });

  it("deletes a single portfolio image of a stylist", async () => {
    const admin = await createAdmin();
    const stylist = await createStylist();
    const imageId = new Types.ObjectId().toString();
    await StylistProfile.updateOne({ userId: stylist.id }, { $set: { portfolio: [imageId] } });

    const del = await api()
      .delete(`/admin/users/${stylist.id}/portfolio/${imageId}`)
      .set(...auth(admin.token))
      .send({});
    expect(del.status).toBe(200);
    expect(del.body.data.portfolio).toHaveLength(0);

    const missing = await api()
      .delete(`/admin/users/${stylist.id}/portfolio/${imageId}`)
      .set(...auth(admin.token))
      .send({});
    expect(missing.status).toBe(404);
  });
});

describe("Moderation uses messages, not SMS", () => {
  it("rejecting a review delivers the admin note as an in-app message", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const admin = await createAdmin();
    // Complete a reservation and review it.
    const date = (await import("./helpers")).futureDate(3);
    const startTime = (
      await api().get(`/stylists/${stylist.id}/availability`).query({ date, serviceIds: stylist.serviceIds[0] })
    ).body.data.slots[0].startTime;
    const booked = await api()
      .post("/reservations")
      .set(...auth(customer.token))
      .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime });
    const { markCompleted } = await import("./helpers");
    await markCompleted(booked.body.data.reservation.id);
    const review = await api()
      .post(`/reservations/${booked.body.data.reservation.id}/review`)
      .set(...auth(customer.token))
      .send({ rating: 5, comment: "x" });

    await api()
      .post(`/admin/reviews/${review.body.data.review.id}/reject`)
      .set(...auth(admin.token))
      .send({ reason: "نامناسب", message: "نظرت تأیید نشد چون نامناسب بود." });

    const msgs = await api().get("/me/messages").set(...auth(customer.token));
    expect(msgs.body.data.items.some((m: any) => m.relatedType === "review_rejected")).toBe(true);
  });
});
