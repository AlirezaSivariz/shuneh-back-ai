import { api, auth } from "./helpers";
import { User } from "../src/models/User";

/**
 * The admin authenticates EXACTLY like any other user — the normal OTP flow.
 * There is no fixed-code shortcut for any phone (including the admin's). Only the
 * 'admin' role (granted by the seed) gives the admin panel access after login.
 */
describe("Admin logs in via the normal OTP flow", () => {
  const ADMIN = "09105959107";

  it("admin uses standard OTP and keeps admin access; no fixed code works", async () => {
    // Simulate the seed: the admin user exists with the 'admin' role.
    await User.create({ phone: ADMIN, roles: ["admin"], isActive: true });

    // Standard request → a real OTP is stored (dev echoes the code).
    const req = await api().post("/auth/otp/request").send({ phone: ADMIN });
    expect(req.status).toBe(201);
    const devCode = req.body.data.devCode as string;
    expect(devCode).toBeTruthy();

    // An arbitrary "fixed" code is rejected — there is no bypass.
    const bad = await api()
      .post("/auth/otp/verify")
      .send({ phone: ADMIN, code: "246810" });
    expect(bad.status).toBe(400);
    expect(bad.body.error.code).toBe("OTP_INCORRECT");

    // The real OTP logs the admin in, and admin access is intact.
    const verify = await api()
      .post("/auth/otp/verify")
      .send({ phone: ADMIN, code: devCode });
    expect(verify.status).toBe(200);
    const token = verify.body.data.tokens.accessToken as string;

    const state = await api()
      .get("/me/state")
      .set(...auth(token));
    expect(state.body.data.roles).toContain("admin");

    const reports = await api()
      .get("/admin/reports")
      .set(...auth(token));
    expect(reports.status).toBe(200);
  });
});
