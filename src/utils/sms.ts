/**
 * Abstraction over an SMS gateway. Swap the implementation (Kavenegar, Twilio, ...)
 * without touching business logic. For now we only log to the console.
 */
export interface SmsProvider {
  send(phone: string, message: string): Promise<void>;
}

export class ConsoleSmsProvider implements SmsProvider {
  async send(phone: string, message: string): Promise<void> {
    // eslint-disable-next-line no-console
    console.log(`[sms] -> ${phone}: ${message}`);
  }
}

export const smsProvider: SmsProvider = new ConsoleSmsProvider();
