import sharp from "sharp";
import { api, auth, createCustomer } from "./helpers";

/** A small valid PNG buffer to upload. */
function samplePng(): Promise<Buffer> {
  return sharp({
    create: { width: 120, height: 120, channels: 3, background: { r: 10, g: 120, b: 80 } },
  })
    .png()
    .toBuffer();
}

describe("POST /me/profile-photo", () => {
  it("lets any authenticated user upload a profile photo and returns a usable URL", async () => {
    const customer = await createCustomer();
    const png = await samplePng();

    const res = await api()
      .post("/me/profile-photo")
      .set(...auth(customer.token))
      .attach("photo", png, "me.png");

    expect(res.status).toBe(200);
    expect(typeof res.body.data.profilePhoto).toBe("string");
    expect(res.body.data.profilePhoto).toMatch(/^https?:\/\//);

    // /me/state now reflects the saved photo (also an absolute URL).
    const state = await api().get("/me/state").set(...auth(customer.token));
    expect(state.body.data.user.profilePhoto).toMatch(/^https?:\/\//);
  });

  it("rejects a request with no file", async () => {
    const customer = await createCustomer();
    const res = await api()
      .post("/me/profile-photo")
      .set(...auth(customer.token));
    expect(res.status).toBe(400);
    expect(res.body.error.code).toBe("NO_FILE");
  });
});
