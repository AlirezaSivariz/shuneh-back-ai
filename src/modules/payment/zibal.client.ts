import { config } from '../../config/env';
import { childLogger, maskTrack } from '../../utils/logger';

const log = childLogger({ module: 'zibal' });

const TIMEOUT_MS = 20_000;

/** Persian messages for the documented request result codes. */
const REQUEST_MESSAGES: Record<number, string> = {
  100: 'موفق',
  102: 'merchant یافت نشد',
  103: 'merchant غیرفعال است',
  104: 'merchant نامعتبر است',
  105: 'مبلغ باید بیشتر از ۱۰۰۰ ریال باشد',
  106: 'آدرس بازگشت (callbackUrl) نامعتبر است',
  113: 'مبلغ تراکنش از سقف مجاز بیشتر است',
  114: 'این درگاه امکان پرداخت با این مبلغ را ندارد',
  115: 'IP درخواست‌دهنده مجاز نیست',
};

/** Verify result codes — 100 ok, 201 already verified (idempotent), else not paid. */
const VERIFY_MESSAGES: Record<number, string> = {
  100: 'پرداخت تأیید شد',
  102: 'merchant یافت نشد',
  103: 'merchant غیرفعال است',
  104: 'merchant نامعتبر است',
  201: 'این تراکنش قبلاً تأیید شده است',
  202: 'پرداخت انجام نشده یا ناموفق بوده است',
  203: 'trackId نامعتبر است',
};

export function requestMessage(code: number): string {
  return REQUEST_MESSAGES[code] ?? `خطای درگاه پرداخت (کد ${code})`;
}
export function verifyMessage(code: number): string {
  return VERIFY_MESSAGES[code] ?? `خطای تأیید پرداخت (کد ${code})`;
}

async function post<T>(pathname: string, body: Record<string, unknown>): Promise<T> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), TIMEOUT_MS);
  try {
    const res = await fetch(`${config.zibal.baseUrl}${pathname}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify(body),
      signal: ctrl.signal,
    });
    const text = await res.text();
    try {
      return JSON.parse(text) as T;
    } catch {
      throw new Error(`Zibal ${pathname} returned non-JSON (HTTP ${res.status})`);
    }
  } finally {
    clearTimeout(timer);
  }
}

export interface ZibalRequestInput {
  amountRial: number;
  callbackUrl: string;
  orderId: string;
  description?: string;
  mobile?: string;
}
export interface ZibalRequestResult {
  result: number;
  trackId: number | null;
  message: string | null;
}

/** Step 1 — create a payment, returning a trackId. */
export async function zibalRequest(input: ZibalRequestInput): Promise<ZibalRequestResult> {
  const raw = await post<{ result?: number; trackId?: number; message?: string }>('/v1/request', {
    merchant: config.zibal.merchant,
    amount: input.amountRial,
    callbackUrl: input.callbackUrl,
    orderId: input.orderId,
    description: input.description ?? 'شارژ کیف پول شونه',
    ...(input.mobile ? { mobile: input.mobile } : {}),
  });
  const result = Number(raw.result ?? -1);
  log.info({ orderId: input.orderId, result, trackId: maskTrack(raw.trackId?.toString()) }, 'Zibal request');
  return { result, trackId: raw.trackId ?? null, message: raw.message ?? null };
}

/** Browser-facing gateway URL for a trackId. */
export function startUrl(trackId: string | number): string {
  return `${config.zibal.baseUrl}/start/${trackId}`;
}

export interface ZibalVerifyResult {
  result: number;
  status: number | null;
  amount: number | null; // Rial
  refNumber: string | null;
  cardNumber: string | null;
  paidAt: string | null;
  orderId: string | null;
}

/** Step 3 — verify a paid transaction. result 100 = ok, 201 = already verified. */
export async function zibalVerify(trackId: string): Promise<ZibalVerifyResult> {
  const raw = await post<Record<string, unknown>>('/v1/verify', {
    merchant: config.zibal.merchant,
    trackId,
  });
  const result = Number(raw.result ?? -1);
  log.info({ trackId: maskTrack(trackId), result, refNumber: raw.refNumber ?? null }, 'Zibal verify');
  return {
    result,
    status: raw.status !== undefined ? Number(raw.status) : null,
    amount: raw.amount !== undefined ? Number(raw.amount) : null,
    refNumber: raw.refNumber != null ? String(raw.refNumber) : null,
    cardNumber: raw.cardNumber != null ? String(raw.cardNumber) : null,
    paidAt: raw.paidAt != null ? String(raw.paidAt) : null,
    orderId: raw.orderId != null ? String(raw.orderId) : null,
  };
}

/** Optional — inquiry for later reconciliation. */
export async function zibalInquiry(trackId: string): Promise<Record<string, unknown>> {
  return post<Record<string, unknown>>('/v1/inquiry', { merchant: config.zibal.merchant, trackId });
}

/** verify success: confirmed now (100) OR already-confirmed previously (201). */
export function isVerifySuccess(code: number): boolean {
  return code === 100 || code === 201;
}
