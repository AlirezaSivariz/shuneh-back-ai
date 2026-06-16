import { api, auth, login, createStylist, randomPhone, allDayOpeningHours } from "./helpers";
import { SalonInvite } from "../src/models/SalonInvite";
import { StylistSalon } from "../src/models/StylistSalon";

const salonDraft = (name = "سالن دعوتی") => ({
  name,
  address: "تهران، خیابان آزادی",
  lng: 51.4,
  lat: 35.7,
  openingHours: allDayOpeningHours,
});

async function createInvite(token: string, targetPhone: string, name?: string) {
  const res = await api()
    .post("/salons/invite")
    .set(...auth(token))
    .send({ targetPhone, salonDraft: salonDraft(name) });
  expect(res.status).toBe(201);
  return res.body.data as { salon: { id: string }; invite: { token: string } };
}

/** Make a real owner (owner role + an active salon) via the invite→accept flow. */
async function makeOwnerWithSalon(ownerPhone: string) {
  const inviter = await createStylist();
  const inv = await createInvite(inviter.token, ownerPhone);
  const owner = await login(ownerPhone);
  await api().post(`/invite/${inv.invite.token}/accept`).set(...auth(owner.token)).send({});
  return owner;
}

describe("Salon lookup by owner phone", () => {
  it("returns an existing owner's salons (salon info only — no owner identity)", async () => {
    const ownerPhone = randomPhone();
    await makeOwnerWithSalon(ownerPhone);

    const S = await createStylist();
    const res = await api()
      .get(`/salons/by-owner-phone?phone=${ownerPhone}`)
      .set(...auth(S.token));

    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(true);
    expect(res.body.data.salons.length).toBe(1);
    const salon = res.body.data.salons[0];
    expect(salon).toHaveProperty("id");
    expect(salon).toHaveProperty("name");
    expect(salon.status).toBe("active");
    // Privacy: no owner identity/contact leaks through.
    expect(salon).not.toHaveProperty("ownerId");
    expect(salon).not.toHaveProperty("phone");
    expect(salon).not.toHaveProperty("firstName");
  });

  it("returns found=false for a phone that is not a known owner", async () => {
    const S = await createStylist();
    const res = await api()
      .get(`/salons/by-owner-phone?phone=${randomPhone()}`)
      .set(...auth(S.token));
    expect(res.status).toBe(200);
    expect(res.body.data.found).toBe(false);
    expect(res.body.data.salons).toEqual([]);
  });

  it("lists ALL salons of an owner who owns several", async () => {
    const ownerPhone = randomPhone();
    await makeOwnerWithSalon(ownerPhone); // salon #1

    // A second stylist invites the SAME owner for a second salon, owner accepts.
    const s2 = await createStylist();
    const inv2 = await createInvite(s2.token, ownerPhone, "شعبه دوم");
    const owner = await login(ownerPhone);
    await api().post(`/invite/${inv2.invite.token}/accept`).set(...auth(owner.token)).send({});

    const S = await createStylist();
    const res = await api()
      .get(`/salons/by-owner-phone?phone=${ownerPhone}`)
      .set(...auth(S.token));
    expect(res.body.data.found).toBe(true);
    expect(res.body.data.salons.length).toBe(2);
  });
});

describe("Stylist invite tracking", () => {
  it("a stylist can create invites for MULTIPLE salons and see them all", async () => {
    const S = await createStylist();
    await createInvite(S.token, randomPhone(), "سالن یک");
    await createInvite(S.token, randomPhone(), "سالن دو");

    const res = await api().get("/stylist/invites").set(...auth(S.token));
    expect(res.status).toBe(200);
    expect(res.body.data.invites.length).toBe(2);
    for (const inv of res.body.data.invites) {
      expect(inv.status).toBe("pending");
      expect(inv.targetPhone).toContain("***"); // masked
      expect(inv.salon.name).toEqual(expect.any(String));
      expect(inv.inviteUrl).toContain("/invite/");
      expect(inv.canCancel).toBe(true);
    }
  });

  it("invites are visible ONLY to their creator", async () => {
    const S = await createStylist();
    await createInvite(S.token, randomPhone());

    const other = await createStylist();
    const res = await api().get("/stylist/invites").set(...auth(other.token));
    expect(res.status).toBe(200);
    expect(res.body.data.invites).toEqual([]);
  });

  it("computes 'expired' for an invite past its expiry", async () => {
    const S = await createStylist();
    const inv = await createInvite(S.token, randomPhone());
    await SalonInvite.updateOne({ token: inv.invite.token }, { expiresAt: new Date(Date.now() - 1000) });

    const res = await api().get("/stylist/invites").set(...auth(S.token));
    expect(res.body.data.invites[0].status).toBe("expired");
    // Persisted, not just computed.
    const dbInvite = await SalonInvite.findOne({ token: inv.invite.token });
    expect(dbInvite?.status).toBe("expired");
  });

  it("resend is rate-limited right after creation, then works once the cooldown passes", async () => {
    const S = await createStylist();
    const inv = await createInvite(S.token, randomPhone());
    const id = (await api().get("/stylist/invites").set(...auth(S.token))).body.data.invites[0].id;

    // Just created (lastSentAt ~ now) → cooldown.
    const tooSoon = await api().post(`/stylist/invites/${id}/resend`).set(...auth(S.token));
    expect(tooSoon.status).toBe(429);
    expect(tooSoon.body.error.code).toBe("RESEND_COOLDOWN");

    // Simulate the cooldown having passed.
    await SalonInvite.updateOne({ token: inv.invite.token }, { lastSentAt: new Date(Date.now() - 10 * 60 * 1000) });
    const ok = await api().post(`/stylist/invites/${id}/resend`).set(...auth(S.token));
    expect(ok.status).toBe(200);
    expect(ok.body.data.status).toBe("pending");
    // Expiry was refreshed into the future.
    expect(new Date(ok.body.data.expiresAt).getTime()).toBeGreaterThan(Date.now());
  });

  it("a stylist cannot resend someone else's invite", async () => {
    const S = await createStylist();
    await createInvite(S.token, randomPhone());
    const id = (await api().get("/stylist/invites").set(...auth(S.token))).body.data.invites[0].id;

    const other = await createStylist();
    const res = await api().post(`/stylist/invites/${id}/resend`).set(...auth(other.token));
    expect(res.status).toBe(404);
    expect(res.body.error.code).toBe("INVITE_NOT_FOUND");
  });

  it("cancel removes the invite, its pending salon and the pending membership", async () => {
    const S = await createStylist();
    const inv = await createInvite(S.token, randomPhone());
    const salonId = inv.salon.id;
    const id = (await api().get("/stylist/invites").set(...auth(S.token))).body.data.invites[0].id;

    const res = await api().post(`/stylist/invites/${id}/cancel`).set(...auth(S.token));
    expect(res.status).toBe(200);
    expect(res.body.data.cancelled).toBe(true);

    // Invite gone (public lookup 404), list empty, pending membership removed.
    const pub = await api().get(`/invite/${inv.invite.token}`);
    expect(pub.status).toBe(404);
    const list = await api().get("/stylist/invites").set(...auth(S.token));
    expect(list.body.data.invites).toEqual([]);
    const link = await StylistSalon.findOne({ stylistId: S.id, salonId });
    expect(link).toBeNull();
  });
});

describe("Owner-invite discovery by phone (no link required)", () => {
  it("a user logging in DIRECTLY discovers their pending invite via GET /me/pending-invites", async () => {
    const ownerPhone = randomPhone();
    const inviter = await createStylist();
    const inv = await createInvite(inviter.token, ownerPhone, "سالن طلایی");

    // The owner logs in with their number — they never opened the invite link.
    const owner = await login(ownerPhone);
    const res = await api().get("/me/pending-invites").set(...auth(owner.token));

    expect(res.status).toBe(200);
    expect(res.body.data.invites.length).toBe(1);
    const item = res.body.data.invites[0];
    expect(item.token).toBe(inv.invite.token);
    expect(item.salonName).toBe("سالن طلایی");
    expect(item.requestedBy).toBeDefined();
  });

  it("a different phone sees no pending invites", async () => {
    const inviter = await createStylist();
    await createInvite(inviter.token, randomPhone());
    const other = await login(); // some other number
    const res = await api().get("/me/pending-invites").set(...auth(other.token));
    expect(res.body.data.invites).toEqual([]);
  });

  it("GET /me/state exposes hasPendingOwnerInvites for the invited phone only", async () => {
    const ownerPhone = randomPhone();
    const inviter = await createStylist();
    await createInvite(inviter.token, ownerPhone);

    const owner = await login(ownerPhone);
    const st = await api().get("/me/state").set(...auth(owner.token));
    expect(st.body.data.hasPendingOwnerInvites).toBe(true);
    expect(st.body.data.roles).not.toContain("owner");

    const other = await login();
    const st2 = await api().get("/me/state").set(...auth(other.token));
    expect(st2.body.data.hasPendingOwnerInvites).toBe(false);
  });

  it("the invited user accepts via the DISCOVERED token (no link) → owner role + active salon", async () => {
    const ownerPhone = randomPhone();
    const inviter = await createStylist();
    await createInvite(inviter.token, ownerPhone);

    const owner = await login(ownerPhone);
    const token = (await api().get("/me/pending-invites").set(...auth(owner.token)))
      .body.data.invites[0].token;

    const acc = await api().post(`/invite/${token}/accept`).set(...auth(owner.token)).send({});
    expect(acc.status).toBe(200);
    expect(acc.body.data.salon.status).toBe("active");
    expect(acc.body.data.roles).toContain("owner");

    // After accepting, the invite no longer surfaces and the flag clears.
    const after = await api().get("/me/pending-invites").set(...auth(owner.token));
    expect(after.body.data.invites).toEqual([]);
    const st = await api().get("/me/state").set(...auth(owner.token));
    expect(st.body.data.hasPendingOwnerInvites).toBe(false);
    expect(st.body.data.roles).toContain("owner");
  });

  it("expired invites are NOT discoverable", async () => {
    const ownerPhone = randomPhone();
    const inviter = await createStylist();
    const inv = await createInvite(inviter.token, ownerPhone);
    await SalonInvite.updateOne(
      { token: inv.invite.token },
      { expiresAt: new Date(Date.now() - 1000) },
    );

    const owner = await login(ownerPhone);
    const res = await api().get("/me/pending-invites").set(...auth(owner.token));
    expect(res.body.data.invites).toEqual([]);
    const st = await api().get("/me/state").set(...auth(owner.token));
    expect(st.body.data.hasPendingOwnerInvites).toBe(false);
  });

  it("POST /onboarding/role accepts 'owner' as a standalone role choice", async () => {
    const u = await login();
    const res = await api().post("/onboarding/role").set(...auth(u.token)).send({ roles: ["owner"] });
    expect(res.status).toBe(200);
    expect(res.body.data.roles).toContain("owner");
  });
});
