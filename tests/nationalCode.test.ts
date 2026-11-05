import { api, auth, login, createCustomer, validNationalCode } from "./helpers";

describe("National code uniqueness", () => {
  it("rejects a national code already registered to another account", async () => {
    const a = await createCustomer();
    const code = (await api().get("/me/state").set(...auth(a.token))).body.data.user
      .nationalCode as string;
    expect(code).toBeTruthy();

    const b = await login();
    const res = await api()
      .patch("/me/personal")
      .set(...auth(b.token))
      .send({ firstName: "نام", lastName: "خانوادگی", nationalCode: code, birthDate: "1990-01-01" });

    expect(res.status).toBe(409);
    expect(res.body.error.code).toBe("NATIONAL_CODE_TAKEN");
  });

  it("lets the SAME user re-save their own national code (idempotent)", async () => {
    const a = await createCustomer();
    const code = (await api().get("/me/state").set(...auth(a.token))).body.data.user
      .nationalCode as string;

    const res = await api()
      .patch("/me/personal")
      .set(...auth(a.token))
      .send({ firstName: "نام", lastName: "خانوادگی", nationalCode: code, birthDate: "1990-01-01" });
    expect(res.status).toBe(200);
  });

  it("adds a national code without requiring the full personal-info payload", async () => {
    const user = await login();
    const code = validNationalCode(42000000);
    const res = await api()
      .patch("/me/national-code")
      .set(...auth(user.token))
      .send({ nationalCode: code });

    expect(res.status).toBe(200);
    expect(res.body.data.nationalCode).toBe(code);
    const state = await api().get("/me/state").set(...auth(user.token));
    expect(state.body.data.user.nationalCode).toBe(code);
  });

  it("validates and enforces uniqueness for profile national-code updates", async () => {
    const existing = await createCustomer();
    const code = (await api().get("/me/state").set(...auth(existing.token))).body.data.user
      .nationalCode as string;
    const user = await login();

    const invalid = await api()
      .patch("/me/national-code")
      .set(...auth(user.token))
      .send({ nationalCode: "123" });
    expect(invalid.status).toBe(400);

    const duplicate = await api()
      .patch("/me/national-code")
      .set(...auth(user.token))
      .send({ nationalCode: code });
    expect(duplicate.status).toBe(409);
    expect(duplicate.body.error.code).toBe("NATIONAL_CODE_TAKEN");
  });

  it("clears an existing national code when an empty value is explicitly saved", async () => {
    const user = await login();
    await api()
      .patch("/me/national-code")
      .set(...auth(user.token))
      .send({ nationalCode: validNationalCode(43000000) });

    const res = await api()
      .patch("/me/national-code")
      .set(...auth(user.token))
      .send({ nationalCode: "" });
    expect(res.status).toBe(200);
    expect(res.body.data.nationalCode).toBeNull();
    const state = await api().get("/me/state").set(...auth(user.token));
    expect(state.body.data.user.nationalCode).toBeNull();
  });
});
