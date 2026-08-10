import { api, auth, login, createAdmin, randomPhone } from "./helpers";

describe("Auth & roles", () => {
  it("creates a new user on first OTP verify and returns tokens", async () => {
    const phone = randomPhone();
    const req = await api().post("/auth/otp/request").send({ phone });
    expect(req.status).toBe(201);
    expect(req.body.data.devCode).toBe("123456"); // fixed in non-prod

    const verify = await api().post("/auth/otp/verify").send({ phone, code: "123456" });
    expect(verify.status).toBe(200);
    expect(verify.body.data.isNewUser).toBe(true);
    expect(verify.body.data.user.roles).toEqual([]);
    expect(verify.body.data.tokens.accessToken).toBeTruthy();
    expect(verify.body.data.tokens.refreshToken).toBeTruthy();
  });

  it("rejects a wrong OTP code", async () => {
    const phone = randomPhone();
    await api().post("/auth/otp/request").send({ phone });
    const verify = await api().post("/auth/otp/verify").send({ phone, code: "000000" });
    expect(verify.status).toBeGreaterThanOrEqual(400);
  });

  it("rotates the refresh token and revokes the old one (reuse fails)", async () => {
    const s = await login();
    const first = await api().post("/auth/refresh").send({ refreshToken: s.refreshToken });
    expect(first.status).toBe(200);
    const newRt = first.body.data.tokens.refreshToken;
    expect(newRt).not.toBe(s.refreshToken);

    // Reusing the OLD (now revoked) refresh token must fail.
    const reuse = await api().post("/auth/refresh").send({ refreshToken: s.refreshToken });
    expect(reuse.status).toBe(401);
    expect(reuse.body.error.code).toBe("REFRESH_TOKEN_REVOKED");
  });

  it("logout truly revokes the refresh token", async () => {
    const s = await login();
    const out = await api().post("/auth/logout").send({ refreshToken: s.refreshToken });
    expect(out.status).toBe(200);
    const after = await api().post("/auth/refresh").send({ refreshToken: s.refreshToken });
    expect(after.status).toBe(401);
  });

  it("records an audit entry for every login (otp + password) and logout", async () => {
    const admin = await createAdmin();
    const phone = randomPhone();

    // OTP login (new user).
    await api().post("/auth/otp/request").send({ phone });
    const otp = await api().post("/auth/otp/verify").send({ phone, code: "123456" });
    expect(otp.status).toBe(200);
    const userId = otp.body.data.user.id as string;

    // Give the user a password so we can exercise the password path too.
    const setPw = await api()
      .post("/auth/password/set")
      .set(...auth(otp.body.data.tokens.accessToken))
      .send({ password: "secret-1234", confirmPassword: "secret-1234" });
    expect(setPw.status).toBe(200);

    // Password login.
    const pw = await api()
      .post("/auth/password/login")
      .send({ phone, password: "secret-1234" });
    expect(pw.status).toBe(200);

    // Logout.
    const out = await api()
      .post("/auth/logout")
      .send({ refreshToken: pw.body.data.tokens.refreshToken });
    expect(out.status).toBe(200);

    // The admin audit log shows login + logout for this user.
    const logs = await api()
      .get("/admin/audit-logs")
      .query({ limit: 100 })
      .set(...auth(admin.token));
    expect(logs.status).toBe(200);
    const mine = (logs.body.data.items as Array<{
      action: string;
      targetType: string;
      targetId: string;
      summary: Record<string, unknown> | null;
    }>).filter((i) => i.targetType === "user" && i.targetId === userId);
    expect(mine.map((i) => i.action)).toEqual(expect.arrayContaining(["auth.login", "auth.logout"]));
    expect(mine.filter((i) => i.action === "auth.login").map((i) => i.summary?.method)).toEqual(
      expect.arrayContaining(["otp", "password"]),
    );
  });

  it("adds roles idempotently and supports multi-role", async () => {
    const s = await login();
    await api().post("/onboarding/role").set(...auth(s.token)).send({ roles: ["customer"] });
    await api().post("/onboarding/role").set(...auth(s.token)).send({ roles: ["customer"] }); // idempotent
    await api().post("/onboarding/role").set(...auth(s.token)).send({ roles: ["stylist"] });
    const state = await api().get("/me/state").set(...auth(s.token));
    expect(state.body.data.roles.sort()).toEqual(["customer", "stylist"]);
  });

  it("never lets a user self-assign the admin role", async () => {
    const s = await login();
    const res = await api().post("/onboarding/role").set(...auth(s.token)).send({ roles: ["admin"] });
    expect(res.status).toBe(400);
    const state = await api().get("/me/state").set(...auth(s.token));
    expect(state.body.data.roles).not.toContain("admin");
  });

  it("authorize() guards role-restricted routes", async () => {
    const s = await login(); // no roles yet
    const denied = await api().get("/stylist/services").set(...auth(s.token));
    expect(denied.status).toBe(403);

    await api().post("/onboarding/role").set(...auth(s.token)).send({ roles: ["stylist"] });
    const allowed = await api().get("/stylist/services").set(...auth(s.token));
    expect(allowed.status).toBe(200);
  });

  it("rejects unauthenticated and malformed tokens", async () => {
    expect((await api().get("/me/state")).status).toBe(401);
    expect((await api().get("/me/state").set("Authorization", "Bearer bad")).status).toBe(401);
  });
});
