import { api, auth, login, createStylist, randomPhone, allDayOpeningHours } from "./helpers";
import { Salon } from "../src/models/Salon";

/**
 * Owner + invite flow.
 *
 * A stylist (S) registers a salon on behalf of a real owner via the invite
 * flow. The owner then logs in (phone == targetPhone), accepts the invite
 * (gaining the "owner" role + activating the salon), and approves/rejects the
 * stylist's pending membership.
 */
describe("owner + invite flow", () => {
  const salonDraft = () => ({
    name: "سالن دعوتی",
    address: "تهران، خیابان آزادی",
    lng: 51.4,
    lat: 35.7,
    openingHours: allDayOpeningHours,
  });

  /**
   * Stylist S creates an invite for a fresh owner phone.
   * Returns the stylist, the owner's phone, and the invite payload.
   */
  async function setupInvite() {
    const S = await createStylist();
    const ownerPhone = randomPhone();
    const res = await api()
      .post("/salons/invite")
      .set(...auth(S.token))
      .send({ targetPhone: ownerPhone, salonDraft: salonDraft() });
    expect(res.status).toBe(201);
    return { S, ownerPhone, invite: res.body.data };
  }

  it("stylist creates an invite -> pending salon + invite link + pending membership", async () => {
    const { S, ownerPhone, invite } = await setupInvite();

    // Response shape.
    expect(invite.salon).toBeDefined();
    expect(invite.salon.id).toEqual(expect.any(String));
    expect(invite.salon.status).toBe("pending");
    expect(invite.invite.token).toEqual(expect.any(String));
    expect(invite.invite.status).toBe("pending");
    // inviteUrl + backward-compatible "link" alias both present.
    expect(typeof invite.inviteUrl).toBe("string");
    expect(invite.inviteUrl).toContain(`/invite/${invite.invite.token}`);
    expect(invite.link).toBe(invite.inviteUrl);

    // The stylist S has a pending membership for this (pending) salon, which
    // nobody owns yet — S must NOT be the owner of the invited salon (even though
    // S owns their own helper-created salon).
    const pendingSalon = await Salon.findById(invite.salon.id);
    expect(pendingSalon?.ownerId).toBeNull();
    expect(ownerPhone).toMatch(/^09\d{9}$/);
  });

  it("GET /invite/:token (public) returns invite info with MASKED phone + salon draft", async () => {
    const { ownerPhone, invite } = await setupInvite();

    // No auth header — this endpoint is public.
    const res = await api().get(`/invite/${invite.invite.token}`);
    expect(res.status).toBe(200);

    const data = res.body.data;
    expect(data.token).toBe(invite.invite.token);
    expect(data.status).toBe("pending");
    // Phone is masked — the full number must NOT be exposed.
    expect(data.targetPhone).toContain("***");
    expect(data.targetPhone).not.toBe(ownerPhone);
    // Salon draft echoed back.
    expect(data.salonDraft).toBeDefined();
    expect(data.salonDraft.name).toBe("سالن دعوتی");
    // Pending salon attached.
    expect(data.salon).toBeDefined();
    expect(data.salon.status).toBe("pending");
    // Requesting stylist info.
    expect(data.requestedBy).toBeDefined();
  });

  it("GET /invite/:token with an unknown token -> 404 INVITE_NOT_FOUND", async () => {
    // 32+ chars so it passes the param validator (min length 10) and reaches
    // the service, which then reports a real not-found.
    const res = await api().get(`/invite/${"z".repeat(32)}`);
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("INVITE_NOT_FOUND");
  });

  it("accept requires the logged-in phone to MATCH targetPhone — different phone is rejected", async () => {
    const { invite } = await setupInvite();

    // A different user accepts -> phone mismatch.
    const intruder = await login(); // some other random phone
    const res = await api()
      .post(`/invite/${invite.invite.token}/accept`)
      .set(...auth(intruder.token))
      .send({});
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("PHONE_MISMATCH");
  });

  it("owner accepts the invite -> salon active + user gains 'owner' role", async () => {
    const { ownerPhone, invite } = await setupInvite();

    const owner = await login(ownerPhone);
    const res = await api()
      .post(`/invite/${invite.invite.token}/accept`)
      .set(...auth(owner.token))
      .send({});
    expect(res.status).toBe(200);

    const data = res.body.data;
    expect(data.salon.status).toBe("active");
    expect(data.salon.ownerId).toBe(owner.user.id);
    expect(data.invite.status).toBe("completed");
    expect(data.roles).toContain("owner");

    // /me/state confirms the owner role + owner block.
    const state = await api().get("/me/state").set(...auth(owner.token));
    expect(state.body.data.roles).toContain("owner");
    expect(state.body.data.owner).toEqual({ salonsCount: 1 });
  });

  it("owner approves the stylist's pending membership -> becomes active", async () => {
    const { S, ownerPhone, invite } = await setupInvite();
    const owner = await login(ownerPhone);
    await api()
      .post(`/invite/${invite.invite.token}/accept`)
      .set(...auth(owner.token))
      .send({});

    // Owner lists their salons.
    const salonsRes = await api().get("/owner/salons").set(...auth(owner.token));
    expect(salonsRes.status).toBe(200);
    expect(salonsRes.body.data.salons.length).toBe(1);
    const salonId = salonsRes.body.data.salons[0].id;

    // Pending stylists for that salon.
    const pendingRes = await api()
      .get(`/owner/salons/${salonId}/stylists?status=pending`)
      .set(...auth(owner.token));
    expect(pendingRes.status).toBe(200);
    const pending = pendingRes.body.data.stylists;
    expect(pending.length).toBe(1);
    expect(pending[0].stylistId).toBe(S.id);
    expect(pending[0].membershipStatus).toBe("pending");

    // Approve.
    const approveRes = await api()
      .post(`/owner/salons/${salonId}/stylists/${S.id}/approve`)
      .set(...auth(owner.token));
    expect(approveRes.status).toBe(200);
    expect(approveRes.body.data.membership.status).toBe("active");

    // Now the stylist shows up as active.
    const activeRes = await api()
      .get(`/owner/salons/${salonId}/stylists?status=active`)
      .set(...auth(owner.token));
    expect(activeRes.body.data.stylists.map((s: { stylistId: string }) => s.stylistId)).toContain(S.id);
  });

  it("owner rejects the stylist's membership -> rejected + warning shape", async () => {
    const { S, ownerPhone, invite } = await setupInvite();
    const owner = await login(ownerPhone);
    await api()
      .post(`/invite/${invite.invite.token}/accept`)
      .set(...auth(owner.token))
      .send({});

    const salonsRes = await api().get("/owner/salons").set(...auth(owner.token));
    const salonId = salonsRes.body.data.salons[0].id;

    const rejectRes = await api()
      .post(`/owner/salons/${salonId}/stylists/${S.id}/reject`)
      .set(...auth(owner.token));
    expect(rejectRes.status).toBe(200);
    expect(rejectRes.body.data.membership.status).toBe("rejected");
    // No upcoming reservations -> warning is null.
    expect(rejectRes.body.data.warning).toBeNull();
  });

  it("a non-owner of a salon cannot list/approve/reject its stylists (403 NOT_SALON_OWNER)", async () => {
    // Owner A owns the salon.
    const { S, ownerPhone, invite } = await setupInvite();
    const ownerA = await login(ownerPhone);
    await api()
      .post(`/invite/${invite.invite.token}/accept`)
      .set(...auth(ownerA.token))
      .send({});
    const salonId = (await api().get("/owner/salons").set(...auth(ownerA.token))).body.data.salons[0].id;

    // Owner B owns a DIFFERENT salon (so they hold the 'owner' role and clear
    // authorize('owner'), but they are not owner of salonId).
    const ownerBPhone = randomPhone();
    const S2 = await createStylist();
    const inviteB = (
      await api()
        .post("/salons/invite")
        .set(...auth(S2.token))
        .send({ targetPhone: ownerBPhone, salonDraft: salonDraft() })
    ).body.data;
    const ownerB = await login(ownerBPhone);
    await api()
      .post(`/invite/${inviteB.invite.token}/accept`)
      .set(...auth(ownerB.token))
      .send({});

    // Owner B tries to view owner A's salon stylists.
    const listRes = await api()
      .get(`/owner/salons/${salonId}/stylists`)
      .set(...auth(ownerB.token));
    expect(listRes.status).toBe(403);
    expect(listRes.body.error.code).toBe("NOT_SALON_OWNER");

    // Owner B tries to approve a stylist on owner A's salon.
    const approveRes = await api()
      .post(`/owner/salons/${salonId}/stylists/${S.id}/approve`)
      .set(...auth(ownerB.token));
    expect(approveRes.status).toBe(403);
    expect(approveRes.body.error.code).toBe("NOT_SALON_OWNER");

    // Owner B tries to reject a stylist on owner A's salon.
    const rejectRes = await api()
      .post(`/owner/salons/${salonId}/stylists/${S.id}/reject`)
      .set(...auth(ownerB.token));
    expect(rejectRes.status).toBe(403);
    expect(rejectRes.body.error.code).toBe("NOT_SALON_OWNER");
  });

  it("a user without the 'owner' role cannot reach /owner routes", async () => {
    const S = await createStylist(); // stylist only, no owner role
    const res = await api().get("/owner/salons").set(...auth(S.token));
    expect(res.status).toBe(403);
  });
});
