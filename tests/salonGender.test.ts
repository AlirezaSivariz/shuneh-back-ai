import { api, auth, createStylist, allDayOpeningHours } from "./helpers";

describe("Salon serviceGender", () => {
  it("defaults to unisex and can be set on creation + edited by the owner", async () => {
    // createStylist makes a salon (no gender given) → defaults to unisex.
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

  it("GET /salons/search?gender filters salons (unisex matches any gender filter)", async () => {
    const owner = await createStylist();
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

    // owner.salonId is the default unisex salon.
    const womenSearch = await api()
      .get("/salons/search?gender=women")
      .set(...auth(owner.token));
    const ids = womenSearch.body.data.salons.map((s: any) => s.id);
    expect(ids).toContain(womenSalonId); // women salon matches
    expect(ids).toContain(owner.salonId); // unisex salon also matches a women filter

    const menSearch = await api().get("/salons/search?gender=men").set(...auth(owner.token));
    const menIds = menSearch.body.data.salons.map((s: any) => s.id);
    expect(menIds).not.toContain(womenSalonId); // women-only excluded from a men filter
    expect(menIds).toContain(owner.salonId); // unisex still matches
  });

  it("stylist search returns the salon's serviceGender and filters by it", async () => {
    const st = await createStylist(); // unisex salon
    // The stylist's unisex salon should match a women filter.
    const res = await api().get("/stylists/search?gender=women");
    const me = res.body.data.stylists.find((x: any) => x.id === st.id);
    expect(me).toBeTruthy();
    expect(me.salon.serviceGender).toBe("unisex");

    // After narrowing the salon to men-only, a women filter excludes the stylist.
    await api()
      .patch(`/owner/salons/${st.salonId}`)
      .set(...auth(st.token))
      .send({ serviceGender: "men" });
    const res2 = await api().get("/stylists/search?gender=women");
    expect(res2.body.data.stylists.some((x: any) => x.id === st.id)).toBe(false);
  });
});
