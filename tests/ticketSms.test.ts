import { api, auth, createAdmin, createCustomer } from "./helpers";
import { smsProvider } from "../src/utils/sms";
import { TICKET_SMS_TEMPLATES } from "../src/modules/ticket/ticket.templates";

beforeEach(() => {
  jest.clearAllMocks();
});

describe("Ticket — SMS notifications", () => {
  it("sends a ticket_created SMS when a user creates a ticket", async () => {
    const customer = await createCustomer();

    const res = await api()
      .post("/me/tickets")
      .set(...auth(customer.token))
      .send({ subject: "مشکل در رزرو", priority: "medium", message: "سلام، وقت رزرو من نمایش داده نمی‌شود." });

    expect(res.status).toBe(201);
    expect(smsProvider.send).toHaveBeenCalledTimes(1);
    expect(smsProvider.send).toHaveBeenCalledWith(
      customer.phone,
      TICKET_SMS_TEMPLATES.CREATED,
      { event: "ticket_created" },
    );
  });

  it("sends a ticket_admin_replied SMS when an admin replies to a ticket", async () => {
    const admin = await createAdmin();
    const customer = await createCustomer();

    // Customer creates a ticket
    const ticketRes = await api()
      .post("/me/tickets")
      .set(...auth(customer.token))
      .send({ subject: "مشکل در رزرو", priority: "medium", message: "سلام" });
    const ticketId = ticketRes.body.data.id;

    // Clear the SMS mock from the ticket-creation call
    jest.clearAllMocks();

    // Admin replies
    const replyRes = await api()
      .post(`/admin/tickets/${ticketId}/messages`)
      .set(...auth(admin.token))
      .send({ text: "بررسی شد، مشکل حل شده است." });

    expect(replyRes.status).toBe(201);
    expect(smsProvider.send).toHaveBeenCalledTimes(1);
    expect(smsProvider.send).toHaveBeenCalledWith(
      customer.phone,
      TICKET_SMS_TEMPLATES.ADMIN_REPLIED,
      { event: "ticket_admin_replied" },
    );
  });

  it("does NOT send SMS when a user replies to their own ticket (only admin replies trigger it)", async () => {
    const customer = await createCustomer();

    const ticketRes = await api()
      .post("/me/tickets")
      .set(...auth(customer.token))
      .send({ subject: "مشکل", priority: "low", message: "سلام" });
    const ticketId = ticketRes.body.data.id;

    // Clear the ticket-creation SMS
    jest.clearAllMocks();

    // Customer replies (not admin)
    await api()
      .post(`/me/tickets/${ticketId}/messages`)
      .set(...auth(customer.token))
      .send({ text: "دوباره سلام" });

    // No SMS should be sent (only admin replies notify)
    expect(smsProvider.send).not.toHaveBeenCalled();
  });

  it("still creates the ticket successfully when SMS sending fails", async () => {
    (smsProvider.send as jest.Mock).mockRejectedValueOnce(new Error("SMS gateway timeout"));

    const customer = await createCustomer();

    const res = await api()
      .post("/me/tickets")
      .set(...auth(customer.token))
      .send({ subject: "مشکل", priority: "medium", message: "تست" });

    // The ticket is still created despite the SMS failure
    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty("id");
  });

  it("still replies successfully when SMS sending fails", async () => {
    const admin = await createAdmin();
    const customer = await createCustomer();

    const ticketRes = await api()
      .post("/me/tickets")
      .set(...auth(customer.token))
      .send({ subject: "مشکل", priority: "medium", message: "سلام" });
    const ticketId = ticketRes.body.data.id;

    jest.clearAllMocks();
    (smsProvider.send as jest.Mock).mockRejectedValueOnce(new Error("SMS gateway timeout"));

    const res = await api()
      .post(`/admin/tickets/${ticketId}/messages`)
      .set(...auth(admin.token))
      .send({ text: "بررسی شد" });

    expect(res.status).toBe(201);
    expect(res.body.data).toHaveProperty("id");
  });
});
