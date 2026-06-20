import { config } from '../config/env';
import { SmsLog } from '../models/SmsLog';

/** Context for a notification SMS (used for the delivery log). */
export interface SmsMeta {
  /** Business event label, e.g. 'reservation_created', 'salon_invite'. */
  event?: string;
}

/**
 * SMS / OTP gateway abstraction. Selected via SMS_DRIVER.
 *
 * OTP is owned by the PROVIDER: `sendOtp` asks the gateway to generate + send a
 * code, and `verifyOtp` asks the gateway to check it. We never store or compare
 * codes ourselves. `send` is for generic transactional messages (notifications).
 */
export interface SmsProvider {
  /** Ask the gateway to send a verification code. devCode is only for the stub. */
  sendOtp(phone: string): Promise<{ devCode?: string }>;
  /** Ask the gateway whether a code is valid. true = correct (and not expired). */
  verifyOtp(phone: string, code: string): Promise<boolean>;
  /** Generic transactional SMS (best-effort; used by NotificationService). */
  send(phone: string, message: string, meta?: SmsMeta): Promise<void>;
}

/** Persist a notification-SMS delivery record (best-effort; never throws). */
async function recordSmsLog(entry: {
  recipientMasked: string;
  event: string;
  provider: 'limosms' | 'stub';
  success: boolean;
  messageId?: unknown;
  error?: string | null;
}): Promise<void> {
  try {
    await SmsLog.create({
      recipientMasked: entry.recipientMasked,
      event: entry.event,
      provider: entry.provider,
      success: entry.success,
      messageId: entry.messageId != null ? String(entry.messageId) : null,
      error: entry.error ?? null,
    });
  } catch {
    /* logging must never break the send path */
  }
}

/** Fixed code used by the dev/test stub only. */
const DEV_OTP_CODE = '123456';

/** Dev/test driver — logs and accepts a fixed code. NEVER used in production. */
export class ConsoleSmsProvider implements SmsProvider {
  async sendOtp(phone: string): Promise<{ devCode?: string }> {
    // eslint-disable-next-line no-console
    console.log(`[sms] OTP for ${phone}: ${DEV_OTP_CODE}`);
    return config.isDev ? { devCode: DEV_OTP_CODE } : {};
  }

  async verifyOtp(_phone: string, code: string): Promise<boolean> {
    return code === DEV_OTP_CODE;
  }

  async send(phone: string, message: string, meta?: SmsMeta): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[sms] -> ${phone}: ${message}`);
    await recordSmsLog({
      recipientMasked: maskMobile(phone),
      event: meta?.event ?? 'notification',
      provider: 'stub',
      success: true,
    });
  }
}

/** Mask a phone for logs (0912***6789) — never log the full subscriber number. */
export function maskMobile(phone: string): string {
  const d = phone.replace(/\D/g, '');
  return d.length < 8 ? '***' : `${d.slice(0, 4)}***${d.slice(-4)}`;
}

/**
 * Normalize any Iranian mobile input to the `09xxxxxxxxx` form LimoSMS expects.
 * Handles Persian/Arabic digits and the +98 / 0098 / 98 country-code variants.
 * Returns the cleaned digits unchanged if it doesn't match a known shape.
 */
export function toLimoMobile(input: string): string {
  const en = input
    .replace(/[۰-۹]/g, (d) => String('۰۱۲۳۴۵۶۷۸۹'.indexOf(d)))
    .replace(/[٠-٩]/g, (d) => String('٠١٢٣٤٥٦٧٨٩'.indexOf(d)));
  const digits = en.replace(/\D/g, '');
  if (digits.startsWith('0098')) return '0' + digits.slice(4);
  if (digits.startsWith('98') && digits.length === 12) return '0' + digits.slice(2);
  if (digits.startsWith('9') && digits.length === 10) return '0' + digits;
  return digits;
}

/** Parsed LimoSMS envelope (field casing is normalized to be safe). */
interface LimoResponse {
  success: boolean | undefined;
  message: string | undefined;
  messageId: unknown;
}

/**
 * LimoSMS — the gateway both GENERATES/sends (sendcode) and VERIFIES (checkcode)
 * the OTP. We only call those endpoints; no code is generated or stored on our side.
 *
 * Diagnostics: every call logs the HTTP status and the gateway's `{Success,Message}`
 * (the ApiKey and full subscriber number are NEVER logged). On any HTTP error the
 * raw body is preserved in the thrown error and the log, so the REAL reason a
 * request was rejected (bad ApiKey, low credit, IP not allowed, bad number…) is
 * visible server-side instead of being masked behind a generic "HTTP 4xx".
 */
export class LimoSmsProvider implements SmsProvider {
  private readonly base = 'https://api.limosms.com/api';

  private headers() {
    if (!config.limoSmsApiKey) throw new Error('LIMOSMS_API_KEY is not set (env)');
    return { 'Content-Type': 'application/json', ApiKey: config.limoSmsApiKey };
  }

  /** POST a JSON body and return { status, raw, parsed } — never throws on non-2xx. */
  private async post(
    path: string,
    body: Record<string, unknown>,
  ): Promise<{ status: number; raw: string; parsed: LimoResponse }> {
    const res = await fetch(`${this.base}${path}`, {
      method: 'POST',
      headers: this.headers(),
      body: JSON.stringify(body),
    });
    const raw = await res.text().catch(() => '');
    let json: Record<string, unknown> = {};
    try {
      json = raw ? (JSON.parse(raw) as Record<string, unknown>) : {};
    } catch {
      /* non-JSON body — keep raw for the log */
    }
    // LimoSMS documents PascalCase {Success, Message, MessageId}; accept other casings.
    const success = (json.Success ?? json.success ?? json.IsSuccess) as boolean | undefined;
    const message = (json.Message ?? json.message ?? json.Error) as string | undefined;
    const messageId = json.MessageId ?? json.messageId ?? json.MessageID;
    return { status: res.status, raw, parsed: { success, message, messageId } };
  }

  async sendOtp(phone: string): Promise<{ devCode?: string }> {
    const mobile = toLimoMobile(phone);
    const { status, raw, parsed } = await this.post('/sendcode', {
      Mobile: mobile,
      Footer: config.limoSmsFooter,
    });

    const ok = status >= 200 && status < 300 && parsed.success === true;
    // eslint-disable-next-line no-console
    console[ok ? 'log' : 'error'](
      `[limosms] sendcode mobile=${maskMobile(mobile)} http=${status} ` +
        `Success=${parsed.success} Message=${JSON.stringify(parsed.message ?? null)}` +
        (ok ? '' : ` raw=${raw.slice(0, 300)}`),
    );

    if (!ok) {
      // Surface the gateway's own Message (the real reason) up to the caller's log.
      throw new Error(
        `LimoSMS sendcode rejected (http=${status}, Success=${parsed.success}): ` +
          (parsed.message || raw.slice(0, 200) || 'no message'),
      );
    }
    return {};
  }

  async verifyOtp(phone: string, code: string): Promise<boolean> {
    const mobile = toLimoMobile(phone);
    const { status, raw, parsed } = await this.post('/checkcode', { Mobile: mobile, Code: code });

    // A wrong/expired code is a normal Success:false at HTTP 200 → return false.
    // A non-2xx is an operational failure (bad ApiKey, etc.) → throw so the caller
    // shows a retryable error rather than silently treating it as "wrong code".
    if (status < 200 || status >= 300) {
      // eslint-disable-next-line no-console
      console.error(
        `[limosms] checkcode mobile=${maskMobile(mobile)} http=${status} raw=${raw.slice(0, 300)}`,
      );
      throw new Error(
        `LimoSMS checkcode rejected (http=${status}): ${parsed.message || raw.slice(0, 200) || 'no message'}`,
      );
    }
    // eslint-disable-next-line no-console
    console.log(
      `[limosms] checkcode mobile=${maskMobile(mobile)} http=${status} Success=${parsed.success}`,
    );
    return parsed.success === true;
  }

  /**
   * Generic notification SMS via LimoSMS `sendsms` (separate from OTP's
   * sendcode/checkcode). Best-effort: NEVER throws — a failed notification must
   * not break the domain operation. Logs the gateway's MessageId on success and
   * its real Message on failure, so delivery can be traced later.
   */
  async send(phone: string, message: string, meta?: SmsMeta): Promise<void> {
    const mobile = toLimoMobile(phone);
    const event = meta?.event ?? 'notification';
    const masked = maskMobile(mobile);
    if (!config.limoSmsApiKey || !config.limoSmsSenderNumber) {
      // eslint-disable-next-line no-console
      console.warn(
        `[limosms] sendsms skipped for ${masked} — ` +
          'LIMOSMS_API_KEY / LIMOSMS_SENDER_NUMBER not set',
      );
      await recordSmsLog({
        recipientMasked: masked,
        event,
        provider: 'limosms',
        success: false,
        error: 'sender/apikey not configured',
      });
      return;
    }
    try {
      const { status, raw, parsed } = await this.post('/sendsms', {
        SenderNumber: config.limoSmsSenderNumber,
        Message: message,
        // The recipient list — an array even for a single number. Empty
        // SendTimeSpan (omitted) means "send immediately".
        MobileNumber: [mobile],
        SendToBlocksNumber: false,
      });
      const ok = status >= 200 && status < 300 && parsed.success === true;
      // eslint-disable-next-line no-console
      console[ok ? 'log' : 'error'](
        `[limosms] sendsms event=${event} mobile=${masked} http=${status} ` +
          `Success=${parsed.success}` +
          (ok
            ? ` MessageId=${JSON.stringify(parsed.messageId ?? null)}`
            : ` Message=${JSON.stringify(parsed.message ?? null)} raw=${raw.slice(0, 300)}`),
      );
      await recordSmsLog({
        recipientMasked: masked,
        event,
        provider: 'limosms',
        success: ok,
        messageId: ok ? parsed.messageId : null,
        error: ok ? null : parsed.message ?? raw.slice(0, 200) ?? `http ${status}`,
      });
    } catch (err) {
      // eslint-disable-next-line no-console
      console.error(`[limosms] sendsms failed for ${masked}:`, (err as Error).message);
      await recordSmsLog({
        recipientMasked: masked,
        event,
        provider: 'limosms',
        success: false,
        error: (err as Error).message,
      });
    }
  }
}

export const smsProvider: SmsProvider =
  config.smsDriver === 'limosms' ? new LimoSmsProvider() : new ConsoleSmsProvider();
