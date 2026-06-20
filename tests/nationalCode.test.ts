import { api, auth, login, createCustomer } from "./helpers";

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
});
