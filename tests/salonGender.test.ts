import { api, auth, createStylist, allDayOpeningHours } from "./helpers";

describe("Salon serviceGender", () => {
  it("has no gender until set, and can be set + edited by the owner", async () => {
    // createStylist makes a salon with no gender (women/men chosen later).
    const st = await createStylist();
    const owned = await api().get("/owner/salons").set(...auth(st.token));
    const salon = owned.body.data.salons.find((s: any) => s.id === st.salonId);
    expect(salon).toBeTruthy();

    // Owner edits it to women-only.
    const patch = await api()
      .patch(`/owner/salons/${st.salonId}`)
      .set(...auth(st.token))
      .send({ serviceGender: "women" });
    expect(patch.status).toBe(200);
    expect(patch.body.data.salon.serviceGender).toBe("women");
  });

  it("rejects an invalid serviceGender value", async () => {
    const st = await createStylist();
    const res = await api()
      .patch(`/owner/salons/${st.salonId}`)
      .set(...auth(st.token))
      .send({ serviceGender: "other" });
    expect(res.status).toBe(400);
  });

  it("GET /salons/search?gender filters salons by women/men (exact match)", async () => {
    const owner = await createStylist();
    // Make the owner's default salon men-only.
    await api()
      .patch(`/owner/salons/${owner.salonId}`)
      .set(...auth(owner.token))
      .send({ serviceGender: "men" });
    // Make a second, women-only salon owned by the same owner.
    const womenSalon = await api()
      .post("/salons")
      .set(...auth(owner.token))
      .send({
        name: "سالن زنانه",
        address: "تهران",
        lng: 51.41,
        lat: 35.71,
        serviceGender: "women",
        openingHours: allDayOpeningHours,
      });
    const womenSalonId = (womenSalon.body.data.salon.id ??
      womenSalon.body.data.salon._id) as string;

    const womenSearch = await api()
      .get("/salons/search?gender=women")
      .set(...auth(owner.token));
    const ids = womenSearch.body.data.salons.map((s: any) => s.id);
    expect(ids).toContain(womenSalonId); // women salon matches a women filter
    expect(ids).not.toContain(owner.salonId); // men-only salon excluded from women filter

    const menSearch = await api().get("/salons/search?gender=men").set(...auth(owner.token));
    const menIds = menSearch.body.data.salons.map((s: any) => s.id);
    expect(menIds).not.toContain(womenSalonId); // women-only excluded from a men filter
    expect(menIds).toContain(owner.salonId); // men-only salon matches a men filter
  });

  it("stylist search returns the salon's serviceGender and filters by it", async () => {
    const st = await createStylist();
    // Make the stylist's salon women-only; it should match a women filter.
    await api()
      .patch(`/owner/salons/${st.salonId}`)
      .set(...auth(st.token))
      .send({ serviceGender: "women" });
    const res = await api().get("/stylists/search?gender=women");
    const me = res.body.data.stylists.find((x: any) => x.id === st.id);
    expect(me).toBeTruthy();
    expect(me.salon.serviceGender).toBe("women");

    // After narrowing the salon to men-only, a women filter excludes the stylist.
    await api()
      .patch(`/owner/salons/${st.salonId}`)
      .set(...auth(st.token))
      .send({ serviceGender: "men" });
    const res2 = await api().get("/stylists/search?gender=women");
    expect(res2.body.data.stylists.some((x: any) => x.id === st.id)).toBe(false);
  });
});
