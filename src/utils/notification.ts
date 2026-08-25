/**
 * Thin notification abstraction (stub). Higher-level than the raw SMS gateway:
 * business code calls semantic methods and the implementation decides the
 * channel. For now everything is delegated to SMS / the console.
 *
 * All methods are best-effort and MUST NOT throw into the caller — notifying a
 * user should never fail a domain operation.
 */
import { smsProvider } from "./sms";
import type { SettlementStatus } from "../models/StylistSettlement";
import { toJalaliLabel } from "./jalali";

export interface NotificationService {
  /** Tell the stylist a new reservation was booked. */
  reservationCreated(
    phone: string,
    info: {
      date: string;
      startTime: string;
      audience: "customer" | "stylist";
      hasNote?: boolean;
    },
  ): Promise<void>;
  reservationCancelled(
    phone: string,
    info: { date: string; startTime: string; reason?: string },
  ): Promise<void>;
  reservationRescheduled(
    phone: string,
    info: { date: string; startTime: string; by: "customer" | "stylist" },
  ): Promise<void>;
  /** Invite the customer to review + tip after a completed service. */
  serviceCompleted(phone: string, info: { link: string }): Promise<void>;
  /** Tell a stylist their request to join a salon was declined by the owner. */
  salonMembershipRejected(
    phone: string,
    info: { salonName?: string },
  ): Promise<void>;
  /** Tell a stylist their request to join a salon was APPROVED by the owner. */
  salonMembershipApproved(
    phone: string,
    info: { salonName?: string },
  ): Promise<void>;
  /** Tell a stylist that a salon owner invited them to work there. */
  salonInviteFromOwner(
    phone: string,
    info: { salonName?: string },
  ): Promise<void>;
  /**
   * Warn a stylist that an hours change left some future reservations outside
   * their current working hours and need their attention (no auto-cancel).
   */
  workingHoursNeedReview(phone: string, info: { count: number }): Promise<void>;
  /** Notify a customer that their debt exceeded the threshold and they are locked. */
  debtLocked(
    phone: string,
    info: { amount: number; threshold: number },
  ): Promise<void>;
  /** Notify a customer that their debt was cleared / lock was removed. */
  debtUnlocked(phone: string, info: { amount: number }): Promise<void>;
  /** Notify admin about a new settlement request from a stylist. */
  adminNewSettlementRequest(
    phone: string,
    info: { stylistId: string; amount: number },
  ): Promise<void>;
  /** Notify a stylist that their settlement request status changed. */
  settlementStatusChanged(
    phone: string,
    info: { amount: number; status: SettlementStatus; adminNote?: string },
  ): Promise<void>;
  /** Tell a user their support ticket was created successfully. */
  ticketCreated(phone: string): Promise<void>;
  /** Tell a ticket owner that an admin replied to their ticket. */
  ticketAdminReplied(phone: string): Promise<void>;
}

async function safeSend(phone: string, message: string, event: string) {
  try {
    await smsProvider.send(phone, message, { event });
  } catch {
    /* swallow — notifications are best-effort */
  }
}

class SmsNotificationService implements NotificationService {
  async reservationCreated(
    phone: string,
    info: {
      date: string;
      startTime: string;
      audience: "customer" | "stylist";
      hasNote?: boolean;
    },
  ) {
    const when = `ساعت ${info.startTime} ${toJalaliLabel(info.date)}`;
    if (info.audience === "stylist") {
      const note = info.hasNote ? " (یادداشت مشتری را ببین)" : "";
      await safeSend(
        phone,
        ` شونه: یک رزرو جدید برای ${when} ثبت شد.${note}`,
        "reservation_created",
      );
    } else {
      await safeSend(
        phone,
        ` شونه: رزرو شما برای ${when} با موفقیت ثبت شد.`,
        "reservation_created",
      );
    }
  }

  async reservationCancelled(
    phone: string,
    info: { date: string; startTime: string; reason?: string },
  ) {
    const reason = info.reason ? ` علت: ${info.reason}.` : "";
    await safeSend(
      phone,
      `نوبت شما در سامانه شونه ساعت ${info.startTime} ${toJalaliLabel(info.date)} لغو شد.${reason}`,
      "reservation_cancelled",
    );
  }

  async reservationRescheduled(
    phone: string,
    info: { date: string; startTime: string; by: "customer" | "stylist" },
  ) {
    const who = info.by === "stylist" ? "متخصص" : "مشتری";
    await safeSend(
      phone,
      `نوبت تو توسط ${who} به ساعت ${info.startTime} ${toJalaliLabel(info.date)} منتقل شد.`,
      "reservation_rescheduled",
    );
  }

  async serviceCompleted(phone: string, info: { link: string }) {
    await safeSend(
      phone,
      // `خدمت شما انجام شد 🌟 برای ثبت نظر و انعام وارد شوید: ${info.link}`,
      `خدمت شما انجام شد 🌷 نظرتون رو در بخش «رزروهای انجام‌شده» ثبت کنید. , شونه`,
      "service_completed",
    );
  }

  async salonMembershipRejected(phone: string, info: { salonName?: string }) {
    const where = info.salonName ? ` در سالن «${info.salonName}»` : "";
    await safeSend(
      phone,
      `درخواست عضویت تو${where} پذیرفته نشد.`,
      "salon_membership",
    );
  }

  async salonMembershipApproved(phone: string, info: { salonName?: string }) {
    const where = info.salonName ? ` در سالن «${info.salonName}»` : "";
    await safeSend(
      phone,
      `درخواست عضویت تو${where} تأیید شد.`,
      "salon_membership",
    );
  }

  async salonInviteFromOwner(phone: string, info: { salonName?: string }) {
    const where = info.salonName ? ` سالن «${info.salonName}»` : " یک سالن";
    await safeSend(
      phone,
      `صاحب${where} از تو دعوت کرده تا در آن همکاری کنی. در پنل شونه آن را ببین.`,
      "salon_invite_stylist",
    );
  }

  async workingHoursNeedReview(phone: string, info: { count: number }) {
    await safeSend(
      phone,
      `با تغییر ساعت کاری، ${info.count} نوبت آینده‌ی شما خارج از ساعت کاری فعلی قرار گرفت. این نوبت‌ها لغو نشده‌اند؛ لطفاً در پنل شونه بررسی و ساعت کاری را به‌روزرسانی کنید.`,
      "hours_review",
    );
  }

  async debtLocked(phone: string, info: { amount: number; threshold: number }) {
    await safeSend(
      phone,
      `مبلغ بدهی شما به ${info.amount.toLocaleString("fa")} تومان رسیده است و از سقف مجاز (${info.threshold.toLocaleString("fa")} تومان) بیشتر شده است. امکان ثبت رزرو جدید تا تسویه بدهی وجود ندارد. لطفاً با پشتیبانی تماس بگیرید.`,
      "debt_locked",
    );
  }

  async debtUnlocked(phone: string, info: { amount: number }) {
    await safeSend(
      phone,
      `بدهی شما به مبلغ ${info.amount.toLocaleString("fa")} تومان تسویه شد. اکنون می‌توانید مجدداً رزرو ثبت کنید.`,
      "debt_unlocked",
    );
  }

  async adminNewSettlementRequest(
    phone: string,
    info: { stylistId: string; amount: number },
  ) {
    await safeSend(
      phone,
      `درخواست تسویه جدید به مبلغ ${info.amount.toLocaleString("fa")} تومان ثبت شده است. لطفاً در بخش مدیریت تسویه‌ها بررسی کنید.`,
      "settlement_request",
    );
  }

  async settlementStatusChanged(
    phone: string,
    info: { amount: number; status: SettlementStatus; adminNote?: string },
  ) {
    const statusLabels: Record<SettlementStatus, string> = {
      pending: "در انتظار بررسی",
      approved: "تأیید شده",
      paid: "پرداخت شده",
      rejected: "رد شده",
    };
    const note = info.adminNote ? ` (توضیحات: ${info.adminNote})` : "";
    await safeSend(
      phone,
      `وضعیت درخواست تسویه‌ی شما به مبلغ ${info.amount.toLocaleString("fa")} تومان به "${statusLabels[info.status]}" تغییر کرد.${note}`,
      "settlement_status",
    );
  }

  async ticketCreated(phone: string) {
    await safeSend(phone, "تیکت شما با موفقیت ثبت شد", "ticket_created");
  }

  async ticketAdminReplied(phone: string) {
    await safeSend(
      phone,
      "پاسخ جدیدی برای تیکت شما ثبت شده است.",
      "ticket_admin_replied",
    );
  }
}

export const notificationService: NotificationService =
  new SmsNotificationService();
