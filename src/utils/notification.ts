/**
 * Thin notification abstraction (stub). Higher-level than the raw SMS gateway:
 * business code calls semantic methods and the implementation decides the
 * channel. For now everything is delegated to SMS / the console.
 *
 * All methods are best-effort and MUST NOT throw into the caller — notifying a
 * customer should never fail a domain operation (e.g. leaving a salon).
 */
import { smsProvider } from './sms';

export interface NotificationService {
  /** Tell a customer their reservation was cancelled, with a human reason. */
  reservationCancelled(phone: string, info: { date: string; startTime: string; reason?: string }): Promise<void>;
}

class StubNotificationService implements NotificationService {
  async reservationCancelled(
    phone: string,
    info: { date: string; startTime: string; reason?: string },
  ): Promise<void> {
    try {
      const reason = info.reason ? ` علت: ${info.reason}.` : '';
      await smsProvider.send(
        phone,
        `نوبت شما در تاریخ ${info.date} ساعت ${info.startTime} لغو شد.${reason}`,
      );
    } catch {
      /* swallow — notifications are best-effort */
    }
  }
}

export const notificationService: NotificationService = new StubNotificationService();
