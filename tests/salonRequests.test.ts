import { api, auth, createStylist } from "./helpers";
import { StylistSalon } from "../src/models/StylistSalon";

/**
 * createStylist() registers an OWN salon via POST /salons, which now also grants
 * the 'owner' role — so a created stylist is simultaneously an owner of their
 * own salon. These tests cover both that, and the reverse (owner→stylist) invite.
 */
describe("Stylist who creates a salon becomes its owner", () => {
  it("grants the 'owner' role, an active self-membership, and owner-panel access", async () => {
    const s = await createStylist();

    const state = await api().get("/me/state").set(...auth(s.token));
    expect(state.body.data.roles).toEqual(expect.arrayContaining(["stylist", "owner"]));

    const salons = await api().get("/owner/salons").set(...auth(s.token));
    expect(salons.status).toBe(200);
    expect(salons.body.data.salons.some((x: { id: string }) => x.id === s.salonId)).toBe(true);

    const link = await StylistSalon.findOne({ stylistId: s.id, salonId: s.salonId });
    expect(link?.status).toBe("active");
    expect(link?.requestedBy).toBe("stylist");
  });
});

describe("Owner invites a stylist (reverse of the join flow)", () => {
  async function setup() {
    const owner = await createStylist(); // owner of their own salon
    const stylist = await createStylist(); // the invitee
    return { owner, stylist };
  }

  it("owner invites → pending owner-initiated membership that the stylist accepts → active", async () => {
    const { owner, stylist } = await setup();

    const res = await api()
      .post(`/owner/salons/${owner.salonId}/invite-stylist`)
      .set(...auth(owner.token))
      .send({ stylistId: stylist.id });
    expect(res.status).toBe(201);
    expect(res.body.data.membership.status).toBe("pending");

    const link = await StylistSalon.findOne({ stylistId: stylist.id, salonId: owner.salonId });
    expect(link?.requestedBy).toBe("owner");
    expect(link?.status).toBe("pending");

    // The stylist sees the request (with salon + owner info).
    const reqs = await api()
      .get("/stylist/salon-requests?status=pending")
      .set(...auth(stylist.token));
    expect(reqs.body.data.requests.length).toBe(1);
    expect(reqs.body.data.requests[0].salon.id).toBe(owner.salonId);
    const id = reqs.body.data.requests[0].id;

    // Accept → active membership (counts toward bookability like any other).
    const acc = await api().post(`/stylist/salon-requests/${id}/accept`).set(...auth(stylist.token));
    expect(acc.status).toBe(200);
    expect(acc.body.data.status).toBe("active");
    expect((await StylistSalon.findById(id))?.status).toBe("active");
  });

  it("the owner sees the sent invite as requestedBy='owner' in their salon stylists list", async () => {
    const { owner, stylist } = await setup();
    await api().post(`/owner/salons/${owner.salonId}/invite-stylist`).set(...auth(owner.token)).send({ stylistId: stylist.id });

    const list = await api()
      .get(`/owner/salons/${owner.salonId}/stylists?status=pending`)
      .set(...auth(owner.token));
    const row = list.body.data.stylists.find((x: { stylistId: string }) => x.stylistId === stylist.id);
    expect(row).toBeDefined();
    expect(row.requestedBy).toBe("owner");
  });

  it("dedup: a second invite to a pending stylist → 409 ALREADY_PENDING", async () => {
    const { owner, stylist } = await setup();
    await api().post(`/owner/salons/${owner.salonId}/invite-stylist`).set(...auth(owner.token)).send({ stylistId: stylist.id });
    const dup = await api()
      .post(`/owner/salons/${owner.salonId}/invite-stylist`)
      .set(...auth(owner.token))
      .send({ stylistId: stylist.id });
    expect(dup.status).toBe(409);
    expect(dup.body.error.code).toBe("ALREADY_PENDING");
  });

  it("the stylist can reject an owner request", async () => {
    const { owner, stylist } = await setup();
    await api().post(`/owner/salons/${owner.salonId}/invite-stylist`).set(...auth(owner.token)).send({ stylistId: stylist.id });
    const id = (await api().get("/stylist/salon-requests").set(...auth(stylist.token))).body.data.requests[0].id;

    const rej = await api().post(`/stylist/salon-requests/${id}/reject`).set(...auth(stylist.token));
    expect(rej.status).toBe(200);
    expect(rej.body.data.status).toBe("rejected");
  });

  it("a stylist cannot accept ANOTHER stylist's request (404)", async () => {
    const { owner, stylist } = await setup();
    await api().post(`/owner/salons/${owner.salonId}/invite-stylist`).set(...auth(owner.token)).send({ stylistId: stylist.id });
    const id = (await api().get("/stylist/salon-requests").set(...auth(stylist.token))).body.data.requests[0].id;

    const intruder = await createStylist();
    const res = await api().post(`/stylist/salon-requests/${id}/accept`).set(...auth(intruder.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("REQUEST_NOT_FOUND");
  });

  it("only the salon's owner may invite (403 for a non-owner)", async () => {
    const { owner, stylist } = await setup();
    const other = await createStylist(); // owns a DIFFERENT salon
    const res = await api()
      .post(`/owner/salons/${owner.salonId}/invite-stylist`)
      .set(...auth(other.token))
      .send({ stylistId: stylist.id });
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("NOT_SALON_OWNER");
  });

  it("owner stylist search finds active stylists by name", async () => {
    const owner = await createStylist();
    const res = await api().get("/owner/stylists/search?q=تست").set(...auth(owner.token));
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.data.stylists)).toBe(true);
    expect(res.body.data.stylists.length).toBeGreaterThan(0);
    expect(res.body.data.stylists[0]).toHaveProperty("fullName");
  });
});
