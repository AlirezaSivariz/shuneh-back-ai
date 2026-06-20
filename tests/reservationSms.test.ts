import { api, auth, createCustomer, createStylist, futureDate } from "./helpers";
import { smsProvider } from "../src/utils/sms"; // mocked in tests/setup

const sendMock = smsProvider.send as jest.Mock;
/** Let fire-and-forget notification IIFEs (await User.find → send) settle. */
const flush = () => new Promise((r) => setImmediate(r));

async function book(stylist: { id: string; serviceIds: string[] }, customerToken: string) {
  const date = futureDate(3);
  const slot = (
    await api().get(
      `/stylists/${stylist.id}/availability?date=${date}&serviceIds=${stylist.serviceIds[0]}`,
    )
  ).body.data.slots[0];
  const res = await api()
    .post("/reservations")
    .set(...auth(customerToken))
    .send({ stylistId: stylist.id, serviceIds: [stylist.serviceIds[0]], date, startTime: slot.startTime });
  return res.body.data.reservation;
}

describe("Reservation SMS → both parties", () => {
  it("cancelling notifies BOTH the customer and the stylist", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    const reservation = await book(stylist, customer.token);

    // Isolate the cancel notifications from the booking ones.
    await flush();
    sendMock.mockClear();

    const cancel = await api()
      .post(`/reservations/${reservation.id}/cancel`)
      .set(...auth(customer.token));
    expect(cancel.status).toBe(200);

    await flush();
    await flush();

    const recipients = sendMock.mock.calls.map((c) => c[0]);
    expect(recipients).toContain(customer.phone);
    expect(recipients).toContain(stylist.phone);
    // Each party exactly once (no duplicate/loop).
    expect(recipients.filter((p: string) => p === customer.phone)).toHaveLength(1);
    expect(recipients.filter((p: string) => p === stylist.phone)).toHaveLength(1);
  });

  it("booking notifies BOTH the customer and the stylist", async () => {
    const stylist = await createStylist();
    const customer = await createCustomer();
    sendMock.mockClear();
    await book(stylist, customer.token);
    await flush();
    await flush();
    const recipients = sendMock.mock.calls.map((c) => c[0]);
    expect(recipients).toContain(customer.phone);
    expect(recipients).toContain(stylist.phone);
  });
});
