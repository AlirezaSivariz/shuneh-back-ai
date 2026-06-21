import { api, auth, createStylist, randomPhone } from "./helpers";
import { smsProvider } from "../src/utils/sms"; // the mocked gateway (see tests/setup)

const sendMock = smsProvider.send as jest.Mock;

describe("Notification wiring → SMS gateway", () => {
  it("sending a salon owner-invite dispatches an SMS to the owner (event salon_invite)", async () => {
    const stylist = await createStylist();
    const ownerPhone = randomPhone();
    sendMock.mockClear();

    const res = await api()
      .post("/salons/invite")
      .set(...auth(stylist.token))
      .send({ targetPhone: ownerPhone, salonDraft: { name: "سالن دعوتی" } });
    expect(res.status).toBe(201);

    // The owner received the invite SMS (dispatched synchronously). The message
    // body/link wording is configurable; we only assert delivery to the owner
    // under the 'salon_invite' event.
    const call = sendMock.mock.calls.find((c) => c[0] === ownerPhone);
    expect(call).toBeTruthy();
    expect(call![2]).toMatchObject({ event: "salon_invite" });
  });
});
