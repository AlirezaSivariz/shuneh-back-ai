import { api, auth, login, createStylist, setLocation, validNationalCode } from "./helpers";

/**
 * Province/State + City — the single source of truth for a user's activity
 * area. Since the onboarding "work location" step split out of the personal
 * step, it lives at PATCH /me/location (used by onboarding for both stylists
 * and shop owners, and by the dashboards to edit it later). It is the basis of
 * the /stylists discovery filters (with server-side pagination).
 */

/** The user's province/city as reported by /me/state. */
async function locationOf(token: string) {
  const state = await api().get("/me/state").set(...auth(token));
  return { province: state.body.data.user.province, city: state.body.data.user.city };
}

async function setPersonal(token: string, body: Record<string, unknown>) {
  return api().patch("/me/personal").set(...auth(token)).send(body);
}

async function onboardingStep(token: string): Promise<string> {
  const res = await api().get("/onboarding/state").set(...auth(token));
  return res.body.data.onboardingStep as string;
}

async function addRole(token: string, roles: string[]) {
  await api().post("/onboarding/role").set(...auth(token)).send({ roles });
}

describe("location — dedicated work location step", () => {
  it("the personal step succeeds WITHOUT location for a stylist", async () => {
    const s = await login();
    await addRole(s.token, ["stylist"]);

    const res = await setPersonal(s.token, {
      firstName: "تست",
      lastName: "کاربر",
      nationalCode: validNationalCode(41000000),
      birthDate: "1990-01-01",
    });

    expect(res.status).toBe(200);
    expect(await locationOf(s.token)).toEqual({ province: null, city: null });
    // The stylist now sits at the new 'location' step.
    expect(await onboardingStep(s.token)).toBe("location");
  });

  it("the personal step succeeds WITHOUT location for a shop owner", async () => {
    const s = await login();
    await addRole(s.token, ["owner"]);

    const res = await setPersonal(s.token, {
      firstName: "تست",
      lastName: "کاربر",
      nationalCode: validNationalCode(41000001),
      birthDate: "1990-01-01",
    });

    expect(res.status).toBe(200);
    expect(await locationOf(s.token)).toEqual({ province: null, city: null });
  });

  it("sets the work location and persists it (single source of truth)", async () => {
    const s = await login();
    await addRole(s.token, ["stylist"]);
    await setPersonal(s.token, {
      firstName: "تست",
      lastName: "کاربر",
      nationalCode: validNationalCode(41000002),
      birthDate: "1990-01-01",
    });

    const res = await setLocation(s.token, "فارس", "شیراز");
    expect(res.status).toBe(200);
    expect(await locationOf(s.token)).toEqual({ province: "فارس", city: "شیراز" });

    // Also surfaced by the onboarding state (single source of truth).
    const onboarding = await api().get("/onboarding/state").set(...auth(s.token));
    expect(onboarding.body.data.user.province).toBe("فارس");
    expect(onboarding.body.data.user.city).toBe("شیراز");
  });

  it("advances the stylist from 'location' to the next step", async () => {
    const s = await login();
    await addRole(s.token, ["stylist"]);
    await setPersonal(s.token, {
      firstName: "تست",
      lastName: "کاربر",
      nationalCode: validNationalCode(41000007),
      birthDate: "1990-01-01",
    });
    expect(await onboardingStep(s.token)).toBe("location");

    await setLocation(s.token, "تهران", "تهران");
    expect(await onboardingStep(s.token)).toBe("services");
  });

  it("lets a customer skip the location fields entirely", async () => {
    const s = await login();
    await addRole(s.token, ["customer"]);

    const res = await setPersonal(s.token, {
      firstName: "مشتری",
      lastName: "تست",
      nationalCode: validNationalCode(41000003),
      birthDate: "1990-01-01",
    });

    expect(res.status).toBe(200);
    const loc = await locationOf(s.token);
    expect(loc.province).toBeNull();
    expect(loc.city).toBeNull();
  });
});

describe("location — geo validation", () => {
  it("rejects an unknown province", async () => {
    const s = await login();
    const res = await api()
      .patch("/me/location")
      .set(...auth(s.token))
      .send({ province: "مریخ", city: "تهران" });
    expect(res.status).toBe(400);
  });

  it("rejects a city that does not belong to the province", async () => {
    const s = await login();
    const res = await api()
      .patch("/me/location")
      .set(...auth(s.token))
      .send({ province: "تهران", city: "شیراز" });
    expect(res.status).toBe(400);
  });

  it("rejects province without city (must be provided together)", async () => {
    const s = await login();
    const res = await api()
      .patch("/me/location")
      .set(...auth(s.token))
      .send({ province: "تهران" });
    expect(res.status).toBe(400);
  });
});

describe("location — /me/location (dashboard edit)", () => {
  it("updates only the activity area and reflects it in the state", async () => {
    const s = await login();
    await addRole(s.token, ["owner"]);
    await setPersonal(s.token, {
      firstName: "تست",
      lastName: "کاربر",
      nationalCode: validNationalCode(41000004),
      birthDate: "1990-01-01",
    });
    await setLocation(s.token, "تهران", "تهران");

    const res = await setLocation(s.token, "اصفهان", "اصفهان");

    expect(res.status).toBe(200);
    expect(res.body.data).toEqual({ province: "اصفهان", city: "اصفهان" });
    expect(await locationOf(s.token)).toEqual({ province: "اصفهان", city: "اصفهان" });
  });
});

describe("location — /stylists discovery filters (user-level source of truth)", () => {
  it("filters by province and city using the USER profile, not the salon", async () => {
    await createStylist({ province: "تهران", city: "تهران" });
    await createStylist({ province: "فارس", city: "شیراز" });

    const all = await api().get("/stylists/search");
    expect(all.body.data.total).toBe(2);

    const inFars = await api().get("/stylists/search?province=فارس");
    expect(inFars.body.data.stylists).toHaveLength(1);
    expect(inFars.body.data.stylists[0].province).toBe("فارس");
    expect(inFars.body.data.stylists[0].city).toBe("شیراز");

    const inTehran = await api().get("/stylists/search?city=تهران");
    expect(inTehran.body.data.stylists).toHaveLength(1);
    expect(inTehran.body.data.stylists[0].city).toBe("تهران");
  });

  it("exposes the user-level location on the public profile", async () => {
    const stylist = await createStylist({ province: "تهران", city: "تهران" });
    const res = await api().get(`/stylists/${stylist.id}`);
    expect(res.status).toBe(200);
    expect(res.body.data.stylist.province).toBe("تهران");
    expect(res.body.data.stylist.city).toBe("تهران");
  });
});

describe("location — server-side pagination composes with filters", () => {
  it("returns page/limit/total meta and pages a result set", async () => {
    await createStylist({ province: "تهران", city: "تهران" });
    await createStylist({ province: "تهران", city: "تهران" });
    await createStylist({ province: "فارس", city: "شیراز" });

    const page1 = await api().get("/stylists/search?limit=2");
    expect(page1.body.data.stylists).toHaveLength(2);
    expect(page1.body.data.page).toBe(1);
    expect(page1.body.data.total).toBe(3);
    expect(page1.body.data.totalPages).toBe(2);

    const page2 = await api().get("/stylists/search?limit=2&page=2");
    expect(page2.body.data.stylists).toHaveLength(1);
    expect(page2.body.data.page).toBe(2);

    // Distinct sets across pages.
    const ids1 = page1.body.data.stylists.map((x: any) => x.id);
    const ids2 = page2.body.data.stylists.map((x: any) => x.id);
    expect(ids1.filter((id: string) => ids2.includes(id))).toEqual([]);
  });

  it("a province filter narrows the paginated total", async () => {
    await createStylist({ province: "تهران", city: "تهران" });
    await createStylist({ province: "تهران", city: "تهران" });
    await createStylist({ province: "فارس", city: "شیراز" });

    const res = await api().get("/stylists/search?province=فارس&limit=1&page=1");
    expect(res.body.data.stylists).toHaveLength(1);
    expect(res.body.data.total).toBe(1);
    expect(res.body.data.totalPages).toBe(1);
    expect(res.body.data.stylists[0].province).toBe("فارس");
  });

  it("clamps an out-of-range page to the last page", async () => {
    await createStylist({ province: "تهران", city: "تهران" });
    const res = await api().get("/stylists/search?limit=1&page=99");
    expect(res.status).toBe(200);
    expect(res.body.data.page).toBe(1);
    expect(res.body.data.total).toBe(1);
  });
});
