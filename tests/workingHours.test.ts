import { api, auth, createStylist, randomPhone } from "./helpers";

/** POST /stylist/working-hours with a list of entries. */
function setHours(token: string, entries: Array<{ salonId: string | null; dayOfWeek: number; start: string; end: string }>) {
  return api()
    .post("/stylist/working-hours")
    .set(...auth(token))
    .send({ entries });
}

describe("working-hours — salon opening-hours validation", () => {
  it("an entry INSIDE the salon's opening hours → 200", async () => {
    const st = await createStylist();
    const res = await setHours(st.token, [
      { salonId: st.salonId, dayOfWeek: 1, start: "09:00", end: "12:00" },
    ]);
    expect(res.status).toBe(200);
    // The response is the regrouped weekly schedule.
    const day1 = res.body.data.schedule.find((d: any) => d.dayOfWeek === 1);
    expect(day1.entries).toHaveLength(1);
    expect(day1.entries[0].start).toBe("09:00");
  });

  it("an entry OUTSIDE the salon's opening hours → 400 OUTSIDE_OPENING_HOURS", async () => {
    const st = await createStylist(); // salon open 08:00–20:00
    const res = await setHours(st.token, [
      { salonId: st.salonId, dayOfWeek: 1, start: "07:00", end: "08:00" },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("OUTSIDE_OPENING_HOURS");
  });
});

describe("working-hours — overlap detection", () => {
  it("two overlapping entries on the SAME day → 409 WORKING_HOURS_OVERLAP", async () => {
    const st = await createStylist();
    const res = await setHours(st.token, [
      { salonId: st.salonId, dayOfWeek: 2, start: "09:00", end: "12:00" },
      { salonId: st.salonId, dayOfWeek: 2, start: "11:00", end: "14:00" },
    ]);
    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("WORKING_HOURS_OVERLAP");
  });

  it("ADJACENT non-overlapping intervals (08:00–12:00 & 12:00–15:00) → 200", async () => {
    const st = await createStylist();
    const res = await setHours(st.token, [
      { salonId: st.salonId, dayOfWeek: 3, start: "08:00", end: "12:00" },
      { salonId: st.salonId, dayOfWeek: 3, start: "12:00", end: "15:00" },
    ]);
    expect(res.status).toBe(200);
    const day3 = res.body.data.schedule.find((d: any) => d.dayOfWeek === 3);
    expect(day3.entries).toHaveLength(2);
  });
});

describe("working-hours — salon linkage", () => {
  it("an entry for a salon the stylist is NOT linked to → 403 SALON_NOT_LINKED", async () => {
    const me = await createStylist();
    const other = await createStylist(); // a DIFFERENT stylist's salon

    const res = await setHours(me.token, [
      { salonId: other.salonId, dayOfWeek: 1, start: "09:00", end: "12:00" },
    ]);
    expect(res.status).toBe(403);
    expect(res.body.error.code).toBe("SALON_NOT_LINKED");
  });
});

describe("working-hours — freelance entries", () => {
  it("a freelance entry (salonId:null) skips the opening-hours check → 200", async () => {
    const st = await createStylist();
    // 06:00–07:00 would be OUTSIDE any salon hours, but freelance has no salon
    // to validate against, so it is accepted as long as it is well-ordered.
    const res = await setHours(st.token, [
      { salonId: null, dayOfWeek: 4, start: "06:00", end: "07:00" },
    ]);
    expect(res.status).toBe(200);
    const day4 = res.body.data.schedule.find((d: any) => d.dayOfWeek === 4);
    expect(day4.entries).toHaveLength(1);
    expect(day4.entries[0].salon).toBeNull();
  });
});

describe("working-hours — salon with no opening hours set", () => {
  it("a salon created via invite (openingHours:[]) → 400 SALON_HOURS_NOT_SET", async () => {
    const st = await createStylist();

    // Create a pending salon (no openingHours) via the invite flow; this also
    // gives the stylist a PENDING membership to it (a usable, non-rejected link).
    const invite = await api()
      .post("/salons/invite")
      .set(...auth(st.token))
      .send({ targetPhone: randomPhone(), salonDraft: { name: "سالن بدون ساعت" } });
    expect(invite.status).toBe(201);
    const pendingSalonId = invite.body.data.salon.id as string;

    const res = await setHours(st.token, [
      { salonId: pendingSalonId, dayOfWeek: 1, start: "09:00", end: "12:00" },
    ]);
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("SALON_HOURS_NOT_SET");
  });
});
