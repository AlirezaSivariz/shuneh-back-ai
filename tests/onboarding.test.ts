import { api, auth, login, createStylist, ensureCatalogue, validNationalCode } from "./helpers";

let ncSeed = 30000000;

/**
 * Drive a fresh stylist through the onboarding prefix steps:
 * login → role → personal. After this the onboardingStep is "services".
 * Returns the access token + the stylist's user id.
 */
async function freshStylist() {
  await ensureCatalogue();
  const s = await login();
  // Role FIRST: personal-info only advances the onboarding step once the user
  // already holds the stylist role (updatePersonal gates advance on the role).
  await api().post("/onboarding/role").set(...auth(s.token)).send({ roles: ["stylist"] });
  await api()
    .patch("/me/personal")
    .set(...auth(s.token))
    .send({ firstName: "تست", lastName: "کاربر", nationalCode: validNationalCode(ncSeed++), birthDate: "1990-01-01" });
  const id = (await api().get("/me/state").set(...auth(s.token))).body.data.user.id as string;
  return { token: s.token, id };
}

/** Grab the first N catalogue service ids from GET /services. */
async function catalogueServiceIds(token: string, n: number): Promise<string[]> {
  const cats = (await api().get("/services").set(...auth(token))).body.data.categories;
  const ids: string[] = [];
  for (const c of cats) {
    for (const sv of c.services ?? []) {
      ids.push(sv.id);
      if (ids.length >= n) return ids;
    }
  }
  return ids;
}

async function onboardingStep(token: string): Promise<string> {
  const res = await api().get("/onboarding/state").set(...auth(token));
  return res.body.data.onboardingStep as string;
}

describe("onboarding — step progression", () => {
  it("a fresh stylist (after role+personal) sits at the 'services' step", async () => {
    const st = await freshStylist();
    expect(await onboardingStep(st.token)).toBe("services");
  });

  it("POST /stylist/services advances the step past 'services' to 'workplace'", async () => {
    const st = await freshStylist();
    const ids = await catalogueServiceIds(st.token, 2);

    const res = await api()
      .post("/stylist/services")
      .set(...auth(st.token))
      .send({ items: ids.map((id) => ({ serviceId: id })) });

    expect(res.status).toBe(200);
    expect(await onboardingStep(st.token)).toBe("workplace");
  });

  it("POST /salons (create own salon) advances the step past 'workplace' to 'workingHours'", async () => {
    const st = await freshStylist();
    const ids = await catalogueServiceIds(st.token, 2);
    await api()
      .post("/stylist/services")
      .set(...auth(st.token))
      .send({ items: ids.map((id) => ({ serviceId: id })) });
    expect(await onboardingStep(st.token)).toBe("workplace");

    const salonRes = await api()
      .post("/salons")
      .set(...auth(st.token))
      .send({
        name: "سالن من",
        address: "تهران",
        lng: 51.4,
        lat: 35.7,
        openingHours: Array.from({ length: 7 }, (_, d) => ({
          dayOfWeek: d,
          intervals: [{ start: "08:00", end: "20:00" }],
        })),
      });

    expect(salonRes.status).toBe(201);
    // The create-salon response reports the advanced step directly.
    expect(salonRes.body.data.onboardingStep).toBe("workingHours");
    expect(await onboardingStep(st.token)).toBe("workingHours");
  });
});

describe("onboarding — custom services", () => {
  it("POST /stylist/services/custom → 201, appears in GET /stylist/services with isCustom:true", async () => {
    const st = await freshStylist();

    const res = await api()
      .post("/stylist/services/custom")
      .set(...auth(st.token))
      .send({ name: "خدمت اختصاصی", durationMin: 45, price: 120000 });

    expect(res.status).toBe(201);

    const list = await api().get("/stylist/services").set(...auth(st.token));
    const custom = list.body.data.services.find((s: any) => s.name === "خدمت اختصاصی");
    expect(custom).toBeDefined();
    expect(custom.isCustom).toBe(true);
    expect(custom.price).toBe(120000); // inherits the custom default
    expect(custom.durationMin).toBe(45);
  });

  it("a custom service does NOT appear in the public GET /services catalogue", async () => {
    const st = await freshStylist();
    await api()
      .post("/stylist/services/custom")
      .set(...auth(st.token))
      .send({ name: "خدمت پنهان", durationMin: 30, price: 50000 });

    const cats = (await api().get("/services").set(...auth(st.token))).body.data.categories;
    const names = cats.flatMap((c: any) => (c.services ?? []).map((s: any) => s.name));
    expect(names).not.toContain("خدمت پنهان");
  });

  it("with ONLY a custom service present, POST /stylist/services {items:[]} → 200 (advances)", async () => {
    const st = await freshStylist();
    await api()
      .post("/stylist/services/custom")
      .set(...auth(st.token))
      .send({ name: "تنها خدمت", durationMin: 30, price: 50000 });

    const res = await api()
      .post("/stylist/services")
      .set(...auth(st.token))
      .send({ items: [] });

    expect(res.status).toBe(200);
    expect(await onboardingStep(st.token)).toBe("workplace");
  });

  it("with NO services at all, POST /stylist/services {items:[]} → 400 NO_SERVICES", async () => {
    const st = await freshStylist();

    const res = await api()
      .post("/stylist/services")
      .set(...auth(st.token))
      .send({ items: [] });

    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_SERVICES");
    expect(await onboardingStep(st.token)).toBe("services"); // unchanged
  });
});

describe("onboarding — custom service ownership", () => {
  it("a second stylist cannot DELETE the first stylist's custom service (404 CUSTOM_SERVICE_NOT_FOUND)", async () => {
    const owner = await freshStylist();
    await api()
      .post("/stylist/services/custom")
      .set(...auth(owner.token))
      .send({ name: "متعلق به اول", durationMin: 30, price: 90000 });

    const list = await api().get("/stylist/services").set(...auth(owner.token));
    const custom = list.body.data.services.find((s: any) => s.isCustom);
    const customServiceId = custom.serviceId as string;

    const intruder = await createStylist();

    const del = await api()
      .delete(`/stylist/services/custom/${customServiceId}`)
      .set(...auth(intruder.token));
    expect(del.status).toBe(404);
    expect(del.body.error.code).toBe("CUSTOM_SERVICE_NOT_FOUND");

    const patch = await api()
      .patch(`/stylist/services/custom/${customServiceId}`)
      .set(...auth(intruder.token))
      .send({ price: 1 });
    expect(patch.status).toBe(404);
    expect(patch.body.error.code).toBe("CUSTOM_SERVICE_NOT_FOUND");

    // The owner still sees their custom service untouched.
    const ownerList = await api().get("/stylist/services").set(...auth(owner.token));
    expect(ownerList.body.data.services.some((s: any) => s.serviceId === customServiceId)).toBe(true);
  });
});

describe("onboarding — workplace (join salon)", () => {
  it("joinSalon creates a PENDING membership shown by GET /stylist/salons", async () => {
    // An active stylist owns a salon; a second stylist joins it.
    const owner = await createStylist();
    const joiner = await freshStylist();
    // joiner needs at least one service before workplace makes sense, but
    // joinSalon itself does not require it — exercise the membership directly.

    const res = await api()
      .post("/stylist/salons")
      .set(...auth(joiner.token))
      .send({ salonId: owner.salonId });

    expect(res.status).toBe(201);
    expect(res.body.data.membership.status).toBe("pending");

    const salons = await api().get("/stylist/salons").set(...auth(joiner.token));
    const link = salons.body.data.salons.find((s: any) => s.salon?.id === owner.salonId);
    expect(link).toBeDefined();
    expect(link.status).toBe("pending");
  });
});
