/**
 * Thin notification abstraction (stub). Higher-level than the raw SMS gateway:
 * business code calls semantic methods and the implementation decides the
 * channel. For now everything is delegated to SMS / the console.
 *
 * All methods are best-effort and MUST NOT throw into the caller — notifying a
 * user should never fail a domain operation.
 */
import { smsProvider } from './sms';
import { toJalaliLabel } from './jalali';

export interface NotificationService {
  /** Tell the stylist a new reservation was booked. */
  reservationCreated(
    phone: string,
    info: { date: string; startTime: string; audience: 'customer' | 'stylist'; hasNote?: boolean },
  ): Promise<void>;
  reservationCancelled(phone: string, info: { date: string; startTime: string; reason?: string }): Promise<void>;
  reservationRescheduled(
    phone: string,
    info: { date: string; startTime: string; by: 'customer' | 'stylist' },
  ): Promise<void>;
  /** Invite the customer to review + tip after a completed service. */
  serviceCompleted(phone: string, info: { link: string }): Promise<void>;
  verificationApproved(phone: string): Promise<void>;
  verificationRejected(phone: string, info: { reason?: string }): Promise<void>;
  /** Tell a stylist their request to join a salon was declined by the owner. */
  salonMembershipRejected(phone: string, info: { salonName?: string }): Promise<void>;
  /** Tell a stylist their request to join a salon was APPROVED by the owner. */
  salonMembershipApproved(phone: string, info: { salonName?: string }): Promise<void>;
  /** Tell a stylist that a salon owner invited them to work there. */
  salonInviteFromOwner(phone: string, info: { salonName?: string }): Promise<void>;
  /**
   * Warn a stylist that an hours change left some future reservations outside
   * their current working hours and need their attention (no auto-cancel).
   */
  workingHoursNeedReview(phone: string, info: { count: number }): Promise<void>;
  /** Tell a foreign-national user the result of their account approval review. */
  foreignApprovalDecided(phone: string, info: { approved: boolean; reason?: string }): Promise<void>;
}

async function safeSend(phone: string, message: string) {
  try {
    await smsProvider.send(phone, message);
  } catch {
    /* swallow — notifications are best-effort */
  }
}

class SmsNotificationService implements NotificationService {
  async reservationCreated(
    phone: string,
    info: { date: string; startTime: string; audience: 'customer' | 'stylist'; hasNote?: boolean },
  ) {
    const when = `ساعت ${info.startTime} ${toJalaliLabel(info.date)}`;
    if (info.audience === 'stylist') {
      const note = info.hasNote ? ' (یادداشت مشتری را ببین)' : '';
      await safeSend(phone, `یک رزرو جدید برای ${when} داری.${note}`);
    } else {
      await safeSend(phone, `رزرو تو برای ${when} ثبت شد.`);
    }
  }

  async reservationCancelled(phone: string, info: { date: string; startTime: string; reason?: string }) {
    const reason = info.reason ? ` علت: ${info.reason}.` : '';
    await safeSend(
      phone,
      `نوبت شما ساعت ${info.startTime} ${toJalaliLabel(info.date)} لغو شد.${reason}`,
    );
  }

  async reservationRescheduled(
    phone: string,
    info: { date: string; startTime: string; by: 'customer' | 'stylist' },
  ) {
    const who = info.by === 'stylist' ? 'متخصص' : 'مشتری';
    await safeSend(
      phone,
      `نوبت تو توسط ${who} به ساعت ${info.startTime} ${toJalaliLabel(info.date)} منتقل شد.`,
    );
  }

  async serviceCompleted(phone: string, info: { link: string }) {
    await safeSend(
      phone,
      `خدمت شما انجام شد 🌟 برای ثبت نظر و انعام وارد شوید: ${info.link}`,
    );
  }

  async verificationApproved(phone: string) {
    await safeSend(phone, 'تبریک! پروفایل شما تأیید شد و نشان تأیید (تیک آبی) فعال شد. ✅');
  }

  async verificationRejected(phone: string, info: { reason?: string }) {
    const reason = info.reason ? ` علت: ${info.reason}` : '';
    await safeSend(phone, `درخواست تأیید پروفایل شما رد شد.${reason} می‌توانید پس از اصلاح، دوباره ارسال کنید.`);
  }

  async salonMembershipRejected(phone: string, info: { salonName?: string }) {
    const where = info.salonName ? ` در سالن «${info.salonName}»` : '';
    await safeSend(phone, `درخواست عضویت تو${where} پذیرفته نشد.`);
  }

  async salonMembershipApproved(phone: string, info: { salonName?: string }) {
    const where = info.salonName ? ` در سالن «${info.salonName}»` : '';
    await safeSend(phone, `درخواست عضویت تو${where} تأیید شد.`);
  }

  async salonInviteFromOwner(phone: string, info: { salonName?: string }) {
    const where = info.salonName ? ` سالن «${info.salonName}»` : ' یک سالن';
    await safeSend(phone, `صاحب${where} از تو دعوت کرده تا در آن همکاری کنی. در پنل شونه آن را ببین.`);
  }

  async workingHoursNeedReview(phone: string, info: { count: number }) {
    await safeSend(
      phone,
      `با تغییر ساعت کاری، ${info.count} نوبت آینده‌ی شما خارج از ساعت کاری فعلی قرار گرفت. این نوبت‌ها لغو نشده‌اند؛ لطفاً در پنل شونه بررسی و ساعت کاری را به‌روزرسانی کنید.`,
    );
  }

  async foreignApprovalDecided(phone: string, info: { approved: boolean; reason?: string }) {
    if (info.approved) {
      await safeSend(phone, 'حساب شما توسط پشتیبانی تأیید شد و اکنون فعال است. ✅');
    } else {
      const reason = info.reason ? ` علت: ${info.reason}` : '';
      await safeSend(phone, `درخواست تأیید حساب شما رد شد.${reason}`);
    }
  }
}

export const notificationService: NotificationService = new SmsNotificationService();
