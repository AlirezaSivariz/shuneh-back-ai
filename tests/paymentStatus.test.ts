import { Types } from "mongoose";
import { api, auth, createCustomer } from "./helpers";
import { PaymentTransaction } from "../src/models/PaymentTransaction";

let seq = 0;

async function makeTransaction(
  userId: string,
  overrides: Record<string, unknown> = {},
) {
  seq += 1;
  return PaymentTransaction.create({
    userId: new Types.ObjectId(userId),
    purpose: "reservation_deposit",
    amountToman: 50_000,
    amountRial: 500_000,
    orderId: `pay_test_${seq}`,
    trackId: `track_${seq}`,
    status: "paid",
    callbackUrl: "http://localhost/dashboard/payment/receipt",
    refNumber: "REF123",
    message: null,
    meta: { clientOrderId: `reservation_${seq}` },
    ...overrides,
  });
}

function statusQuery(token: string, params: Record<string, string>) {
  return api().get("/payments/status").set(...auth(token)).query(params);
}

describe("GET /payments/status", () => {
  it("returns the authoritative server state when both callback ids are supplied", async () => {
    const customer = await createCustomer();
    await makeTransaction(customer.id, {
      trackId: "12345",
      orderId: "pay_real",
      refNumber: "REF-99",
      amountToman: 240_000,
      meta: { clientOrderId: "reservation_42" },
    });

    // The callback's orderId is the *client* order id, not our `pay_…` id.
    const res = await statusQuery(customer.token, {
      trackId: "12345",
      orderId: "reservation_42",
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("paid");
    expect(res.body.data.amount).toBe(240_000);
    expect(res.body.data.refNumber).toBe("REF-99");
    expect(res.body.data.orderId).toBe("reservation_42");
  });

  it("finds a transaction by client order id when no trackId is available", async () => {
    const customer = await createCustomer();
    const tx = await makeTransaction(customer.id);

    const res = await statusQuery(customer.token, {
      orderId: String((tx.meta as { clientOrderId: string }).clientOrderId),
    });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("paid");
    expect(res.body.data.trackId).toBe(tx.trackId);
  });

  it("scopes the lookup to the authenticated user", async () => {
    const owner = await createCustomer();
    const other = await createCustomer();
    await makeTransaction(owner.id, { trackId: "owned_track" });

    const res = await statusQuery(other.token, { trackId: "owned_track" });
    expect(res.status).toBe(200);
    expect(res.body.data.status).toBe("failed");
    expect(res.body.data.message).toBe("تراکنش یافت نشد");
  });

  it("maps pending and failed transactions to the receipt statuses", async () => {
    const customer = await createCustomer();
    await makeTransaction(customer.id, { trackId: "pending_track", status: "pending" });
    await makeTransaction(customer.id, { trackId: "failed_track", status: "failed" });

    const pending = await statusQuery(customer.token, { trackId: "pending_track" });
    expect(pending.status).toBe(200);
    expect(pending.body.data.status).toBe("pending");

    const failed = await statusQuery(customer.token, { trackId: "failed_track" });
    expect(failed.status).toBe(200);
    expect(failed.body.data.status).toBe("failed");
  });

  it("requires at least one identifier and requires authentication", async () => {
    const customer = await createCustomer();
    const missing = await statusQuery(customer.token, {});
    expect(missing.status).toBe(200);
    expect(missing.body.data.status).toBe("failed");

    const anonymous = await api().get("/payments/status").query({ trackId: "anything" });
    expect(anonymous.status).toBe(401);
  });
});
