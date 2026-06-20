import { api, auth, createStylist, randomPhone } from "./helpers";
import { smsProvider } from "../src/utils/sms"; // the mocked gateway (see tests/setup)

const sendMock = smsProvider.send as jest.Mock;

describe("Notification wiring → SMS gateway", () => {
  it("sending a salon owner-invite texts the owner the invite link", async () => {
    const stylist = await createStylist();
    const ownerPhone = randomPhone();
    sendMock.mockClear();

    const res = await api()
      .post("/salons/invite")
      .set(...auth(stylist.token))
      .send({ targetPhone: ownerPhone, salonDraft: { name: "سالن دعوتی" } });
    expect(res.status).toBe(201);
    const inviteUrl = res.body.data.inviteUrl as string;

    // The owner received an SMS that contains the invite link (best-effort, but
    // dispatched synchronously so it's already recorded here).
    const call = sendMock.mock.calls.find((c) => c[0] === ownerPhone);
    expect(call).toBeTruthy();
    expect(String(call![1])).toContain(inviteUrl);
  });
});
