/**
 * SMS message templates for ticket notifications.
 * Keep these in one place so they are easy to find and change.
 */
export const TICKET_SMS_TEMPLATES = {
  /** Sent to the user after they successfully create a new support ticket. */
  CREATED: "تیکت شما با موفقیت ثبت شد",
  /** Sent to the ticket owner when an admin posts a reply to their ticket. */
  ADMIN_REPLIED: "پاسخ جدیدی برای تیکت شما ثبت شده است.",
} as const;
