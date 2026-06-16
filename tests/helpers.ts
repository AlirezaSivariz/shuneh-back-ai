import request from "supertest";
import { createApp } from "../src/app";
import { seedServiceCatalogue } from "../src/seed/seed";
import { ServiceCategory } from "../src/models/ServiceCategory";
import { StylistProfile } from "../src/models/StylistProfile";
import { User } from "../src/models/User";

export const app = createApp();
export const api = () => request(app);
export const auth = (token: string): [string, string] => ["Authorization", `Bearer ${token}`];

let phoneCounter = 0;
/** Deterministic, unique Iranian-format phone per call. */
export function randomPhone(): string {
  phoneCounter += 1;
  return "09" + String(100000000 + phoneCounter).slice(0, 9);
}

/** A valid Iranian national code (correct check digit) derived from a seed. */
export function validNationalCode(seed = 13542419): string {
  const base = String(seed).padStart(9, "0").slice(0, 9);
  let sum = 0;
  for (let i = 0; i < 9; i++) sum += Number(base[i]) * (10 - i);
  const r = sum % 11;
  return base + String(r < 2 ? r : 11 - r);
}

/** "YYYY-MM-DD" n days from now (UTC = Iran calendar day components). */
export function futureDate(days: number): string {
  return new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
}

/** openingHours covering every weekday 08:00–20:00. */
export const allDayOpeningHours = Array.from({ length: 7 }, (_, d) => ({
  dayOfWeek: d,
  intervals: [{ start: "08:00", end: "20:00" }],
}));

/** Seed the default service catalogue if empty (cleared between tests). */
export async function ensureCatalogue() {
  if ((await ServiceCategory.estimatedDocumentCount()) === 0) await seedServiceCatalogue();
}

/** OTP login → tokens (OTP is the fixed dev code in non-prod). */
export async function login(phone = randomPhone()) {
  await api().post("/auth/otp/request").send({ phone });
  const res = await api().post("/auth/otp/verify").send({ phone, code: "123456" });
  return {
    phone,
    token: res.body.data.tokens.accessToken as string,
    refreshToken: res.body.data.tokens.refreshToken as string,
    user: res.body.data.user,
  };
}

async function setPersonal(token: string, nc = validNationalCode()) {
  await api()
    .patch("/me/personal")
    .set(...auth(token))
    .send({ firstName: "تست", lastName: "کاربر", nationalCode: nc, birthDate: "1990-01-01" });
}

/** A customer with the role + completed personal info. */
export async function createCustomer() {
  const s = await login();
  await setPersonal(s.token, validNationalCode(13542419 + phoneCounter));
  await api().post("/onboarding/role").set(...auth(s.token)).send({ roles: ["customer"] });
  const state = await api().get("/me/state").set(...auth(s.token));
  return { ...s, id: state.body.data.user.id as string };
}

interface StylistOpts {
  serviceCount?: number;
}

/**
 * A fully ACTIVE stylist: role + personal + N catalogue services + own salon
 * (active) + all-day working hours. The final media step is simulated by
 * flipping the profile to active (uploads need real files).
 */
export async function createStylist(opts: StylistOpts = {}) {
  await ensureCatalogue();
  const s = await login();
  await setPersonal(s.token, validNationalCode(20000000 + phoneCounter));
  await api().post("/onboarding/role").set(...auth(s.token)).send({ roles: ["stylist"] });

  const cats = (await api().get("/services").set(...auth(s.token))).body.data.categories;
  const serviceIds: string[] = [];
  for (const c of cats) {
    for (const sv of c.services ?? []) {
      serviceIds.push(sv.id);
      if (serviceIds.length >= (opts.serviceCount ?? 2)) break;
    }
    if (serviceIds.length >= (opts.serviceCount ?? 2)) break;
  }
  await api()
    .post("/stylist/services")
    .set(...auth(s.token))
    .send({ items: serviceIds.map((id) => ({ serviceId: id })) });

  const salonRes = await api()
    .post("/salons")
    .set(...auth(s.token))
    .send({ name: "سالن تست", address: "تهران", lng: 51.4, lat: 35.7, openingHours: allDayOpeningHours });
  const salon = salonRes.body.data.salon;
  const salonId = (salon.id ?? salon._id) as string;

  await api()
    .post("/stylist/working-hours")
    .set(...auth(s.token))
    .send({
      entries: Array.from({ length: 7 }, (_, d) => ({
        salonId,
        dayOfWeek: d,
        start: "08:00",
        end: "20:00",
      })),
    });

  const id = (await api().get("/me/state").set(...auth(s.token))).body.data.user.id as string;
  // Simulate completing the media step.
  await StylistProfile.updateOne(
    { userId: id },
    { $set: { status: "active", onboardingStep: "completed" } },
  );

  return { ...s, id, serviceIds, salonId };
}

/** Promote a user to admin directly (the only legitimate path is the seed). */
export async function createAdmin() {
  const s = await login();
  await User.updateOne({ _id: s.user.id }, { $addToSet: { roles: "admin" } });
  return s;
}

/** Mark a reservation completed directly (bypasses the time-based cron). */
export async function markCompleted(reservationId: string) {
  const { Reservation } = await import("../src/models/Reservation");
  await Reservation.updateOne(
    { _id: reservationId },
    { $set: { status: "completed", completedAt: new Date() } },
  );
}
