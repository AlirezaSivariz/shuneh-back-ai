/**
 * Zibal payment orchestration — the business layer between the HTTP client
 * (`zibal.client`) and our records (`PaymentTransaction` + the wallet ledger).
 *
 * Flow (wallet top-up):
 *   startWalletTopup → create a PaymentTransaction ('initiated'), ask Zibal for a
 *     trackId, store it ('pending'), return the redirect URL.
 *   handleCallback   → after the user returns to callbackUrl, VERIFY with Zibal,
 *     compare the returned amount against what we recorded (anti-tamper), then —
 *     exactly once — mark the payment 'paid' and credit the wallet.
 *
 * Idempotency: the wallet is credited only by the callback that ATOMICALLY flips
 * the transaction initiated/pending → paid (see `claimPaid`). A duplicate or
 * repeated callback (or Zibal's result 201 "already verified") finds the row
 * already paid and returns the same success without crediting twice.
 *
 * The merchant key never leaves `zibal.client`; nothing here logs it.
 */
import { nanoid } from 'nanoid';
import { config } from '../../config/env';
import { AppError } from '../../utils/AppError';
import { childLogger } from '../../utils/logger';
import { User } from '../../models/User';
import { StylistProfile, planAllowsSmsCampaign, planExpiryDate } from '../../models/StylistProfile';
import {
  PaymentTransaction,
  IPaymentTransaction,
  PaymentPurpose,
} from '../../models/PaymentTransaction';
import { applyWalletChange } from '../wallet/wallet.service';
import { PLAN_PRICES_TOMAN, PurchasablePlan } from './plans';
import {
  zibalRequest,
  zibalVerify,
  startUrl,
  isVerifySuccess,
  requestMessage,
  verifyMessage,
} from './zibal.client';

const log = childLogger({ module: 'payment' });

/** Rial is Zibal's unit; our canonical unit is Toman (1 Toman = 10 Rial). */
const RIAL_PER_TOMAN = 10;

/** Where Zibal returns the browser after payment (our own callback route). */
function callbackUrl(): string {
  return `${config.baseUrl}/payments/callback`;
}

/** Frontend result page the user is finally redirected to (return-from-gateway). */
function resultRedirect(params: Record<string, string>): string {
  const qs = new URLSearchParams(params).toString();
  return `${config.webBaseUrl}/payment/callback?${qs}`;
}

export interface StartTopupResult {
  /** Redirect the browser here to reach the Zibal gateway. */
  paymentUrl: string;
  trackId: string;
  orderId: string;
  transactionId: string;
  amountToman: number;
}

/** Input for the generic gateway start. Amount is whole Toman. */
export interface StartPaymentInput {
  amountToman: number;
  /** Caller's own reference (reservation/order id) — echoed back on the callback. */
  orderId?: string;
  description?: string;
  /** Payer mobile (prefills the Zibal page); falls back to the user's phone. */
  mobile?: string;
  /** Business purpose; defaults to a wallet top-up. */
  purpose?: PaymentPurpose;
  /** Extra non-sensitive context stored on the transaction (e.g. reservationId,
   * planTier) and consumed by the callback to apply the business outcome. */
  meta?: Record<string, unknown>;
}

/**
 * Begin a Zibal payment for `userId`: record the intent, ask Zibal for a trackId,
 * and return the gateway redirect URL. No balance/business change happens here —
 * that only occurs on a verified callback (`handleCallback`).
 *
 * This is the single gateway entry point. `startWalletTopup` is a thin wrapper.
 */
export async function startPayment(
  userId: string,
  input: StartPaymentInput,
): Promise<StartTopupResult> {
  const amount = Math.trunc(input.amountToman);
  if (!Number.isFinite(amount) || amount <= 0) {
    throw AppError.badRequest('مبلغ نامعتبر است', 'INVALID_AMOUNT');
  }

  const user = await User.findById(userId).select('phone').lean();
  if (!user) throw AppError.notFound('کاربر یافت نشد', 'USER_NOT_FOUND');

  const amountRial = amount * RIAL_PER_TOMAN;
  const orderId = `pay_${nanoid(20)}`;
  const purpose: PaymentPurpose = input.purpose ?? 'wallet_topup';
  // Prefer an explicitly supplied valid Iranian mobile, else the account phone.
  const mobile = input.mobile && /^09\d{9}$/.test(input.mobile) ? input.mobile : user.phone;

  // Record the attempt BEFORE hitting the gateway so every trackId we ever
  // receive on the callback maps back to a row we own. The caller's own
  // reference (if any) is kept in meta.clientOrderId for reconciliation.
  const tx = await PaymentTransaction.create({
    provider: 'zibal',
    userId,
    purpose,
    amountToman: amount,
    amountRial,
    orderId,
    status: 'initiated',
    callbackUrl: callbackUrl(),
    meta:
      input.orderId || input.meta
        ? { ...(input.orderId ? { clientOrderId: input.orderId } : {}), ...(input.meta ?? {}) }
        : null,
  });

  let res;
  try {
    res = await zibalRequest({
      amountRial,
      callbackUrl: tx.callbackUrl,
      orderId,
      description: input.description || 'پرداخت شونه',
      mobile,
    });
  } catch (err) {
    // Network / timeout / non-JSON — mark the attempt failed and surface a clean
    // Persian error (the raw cause is logged inside zibal.client / here).
    tx.status = 'failed';
    tx.message = (err as Error).message?.slice(0, 300) ?? 'network error';
    await tx.save();
    log.error({ orderId, err }, 'Payment request failed');
    throw new AppError(502, 'ارتباط با درگاه پرداخت برقرار نشد؛ دوباره تلاش کنید', 'GATEWAY_UNREACHABLE');
  }

  tx.resultCode = res.result;
  tx.message = requestMessage(res.result);

  if (res.result !== 100 || !res.trackId) {
    tx.status = 'failed';
    await tx.save();
    throw AppError.badRequest(requestMessage(res.result), 'GATEWAY_REQUEST_FAILED');
  }

  tx.trackId = String(res.trackId);
  tx.status = 'pending';
  await tx.save();

  return {
    paymentUrl: startUrl(res.trackId),
    trackId: tx.trackId,
    orderId,
    transactionId: String(tx._id),
    amountToman: amount,
  };
}

/**
 * Begin a wallet top-up of `amountToman` for `userId`. Thin wrapper over
 * `startPayment` with the `wallet_topup` purpose; kept as a named export because
 * `wallet.service` delegates to it when `PAYMENT_DRIVER=zibal`.
 */
export async function startWalletTopup(
  userId: string,
  amountToman: number,
): Promise<StartTopupResult> {
  return startPayment(userId, { amountToman, purpose: 'wallet_topup' });
}

/**
 * Start an online subscription-plan purchase for a stylist. The price is read
 * from `PLAN_PRICES_TOMAN` (server-side source of truth) so the amount charged
 * always matches the tier; the tier is applied on the verified callback.
 */
export async function startPlanPurchase(
  userId: string,
  tier: PurchasablePlan,
): Promise<StartTopupResult> {
  const profile = await StylistProfile.findOne({ userId }).select('planTier').lean();
  if (!profile) throw AppError.notFound('پروفایل متخصص یافت نشد', 'STYLIST_NOT_FOUND');

  const amountToman = PLAN_PRICES_TOMAN[tier];
  const label = tier === 'gold' ? 'طلایی' : 'نقره‌ای';
  return startPayment(userId, {
    amountToman,
    purpose: 'plan_purchase',
    description: `خرید پلن ${label} شونه`,
    meta: { planTier: tier },
  });
}

/**
 * Apply a purchased plan: set the tier and keep the paid-feature gate
 * (`smsCampaignEnabled`) in sync. Mirrors the admin `setStylistPlan` outcome.
 */
async function activatePlan(userId: string, tier: PurchasablePlan): Promise<void> {
  const profile = await StylistProfile.findOne({ userId });
  if (!profile) throw new Error(`stylist profile not found for user ${userId}`);
  profile.planTier = tier;
  profile.smsCampaignEnabled = planAllowsSmsCampaign(tier);
  profile.planStartsAt = new Date();
  profile.planExpiresAt = planExpiryDate();
  profile.expiryRemindersSent = [];
  await profile.save();
}

/**
 * Atomically claim a transaction as PAID. Returns the updated row only for the
 * caller that won the race (initiated/pending → paid); a row already 'paid'
 * returns null so the wallet is never credited twice.
 */
async function claimPaid(
  txId: string,
  fields: Partial<Pick<IPaymentTransaction, 'resultCode' | 'message' | 'refNumber' | 'cardNumber' | 'paidAt'>>,
): Promise<IPaymentTransaction | null> {
  return PaymentTransaction.findOneAndUpdate(
    { _id: txId, status: { $in: ['initiated', 'pending'] } },
    { $set: { status: 'paid', ...fields } },
    { new: true },
  );
}

export interface CallbackResult {
  /** Absolute frontend URL the user should be redirected to. */
  redirectUrl: string;
}

/** Build the success query the result page renders (amount in Toman + refNumber). */
function successParams(tx: IPaymentTransaction, trackId: string): Record<string, string> {
  const clientOrderId =
    tx.meta && typeof tx.meta.clientOrderId === 'string' ? tx.meta.clientOrderId : '';
  const params: Record<string, string> = {
    status: 'success',
    trackId,
    orderId: clientOrderId || tx.orderId,
    amount: String(tx.amountToman),
  };
  if (tx.refNumber) params.refNumber = tx.refNumber;
  return params;
}

/**
 * Handle Zibal's return to our callback route. NEVER throws — a browser redirect
 * must always resolve to the frontend result page. Verifies the payment, guards
 * against tampering and double-verify, credits the wallet exactly once.
 */
export async function handleCallback(input: {
  trackId?: string;
  success?: string;
  orderId?: string;
}): Promise<CallbackResult> {
  const trackId = (input.trackId ?? '').trim();
  if (!trackId) {
    return { redirectUrl: resultRedirect({ status: 'failed', reason: 'missing_track' }) };
  }

  const tx = await PaymentTransaction.findOne({ trackId });
  if (!tx) {
    log.warn({ trackId: trackId.slice(0, 6) }, 'Callback for unknown trackId');
    return { redirectUrl: resultRedirect({ status: 'failed', reason: 'not_found' }) };
  }

  // Already settled — respond idempotently without re-verifying / re-crediting.
  if (tx.status === 'paid') {
    return { redirectUrl: resultRedirect(successParams(tx, trackId)) };
  }
  if (tx.status === 'failed') {
    return {
      redirectUrl: resultRedirect({
        status: 'failed',
        reason: 'failed',
        trackId,
        ...(tx.message ? { message: tx.message } : {}),
      }),
    };
  }

  // Zibal signals a canceled/failed payment with success=0; don't bother verifying.
  if (input.success === '0') {
    tx.status = 'failed';
    tx.message = 'پرداخت توسط کاربر لغو شد یا ناموفق بود';
    await tx.save();
    await releaseReservationHold(tx);
    return {
      redirectUrl: resultRedirect({ status: 'failed', reason: 'canceled', trackId, message: tx.message }),
    };
  }

  let verify;
  try {
    verify = await zibalVerify(trackId);
  } catch (err) {
    // Verify failed to reach Zibal — leave the row 'pending' so a later
    // callback / reconciliation can still settle it; tell the user to retry.
    log.error({ trackId: trackId.slice(0, 6), err }, 'Verify network error');
    return { redirectUrl: resultRedirect({ status: 'pending', reason: 'verify_unreachable', trackId }) };
  }

  // 100 = confirmed now, 201 = already confirmed at Zibal. Anything else = not paid.
  if (!isVerifySuccess(verify.result)) {
    tx.status = 'failed';
    tx.resultCode = verify.result;
    tx.message = verifyMessage(verify.result);
    await tx.save();
    log.warn({ orderId: tx.orderId, result: verify.result }, 'Verify not-paid');
    await releaseReservationHold(tx);
    return {
      redirectUrl: resultRedirect({ status: 'failed', reason: 'unverified', trackId, message: tx.message }),
    };
  }

  // Anti-tamper: the amount Zibal confirms MUST match what we recorded (Rial).
  if (verify.amount != null && verify.amount !== tx.amountRial) {
    tx.status = 'failed';
    tx.resultCode = verify.result;
    tx.message = `مبلغ برگشتی (${verify.amount}) با مبلغ ثبت‌شده (${tx.amountRial}) مطابقت ندارد`;
    await tx.save();
    log.error({ orderId: tx.orderId, expected: tx.amountRial, got: verify.amount }, 'Amount mismatch — possible tamper');
    await releaseReservationHold(tx);
    return {
      redirectUrl: resultRedirect({ status: 'failed', reason: 'amount_mismatch', trackId, message: tx.message }),
    };
  }

  // Atomically claim 'paid'. If we lose the race (concurrent/duplicate callback),
  // the payment is already settled — return success without double-crediting.
  const claimed = await claimPaid(String(tx._id), {
    resultCode: verify.result,
    message: verifyMessage(verify.result),
    refNumber: verify.refNumber,
    cardNumber: verify.cardNumber,
    paidAt: verify.paidAt ? new Date(verify.paidAt) : new Date(),
  });
  if (!claimed) {
    return { redirectUrl: resultRedirect(successParams(tx, trackId)) };
  }

  // Apply the business outcome for this purpose. The money IS captured at Zibal
  // (verified); if applying the outcome fails we keep the row 'paid' with a clear
  // note for manual reconciliation and still report success (their money arrived)
  // — we never reverse the payment here.
  try {
    await applyPaymentOutcome(claimed, trackId);
  } catch (err) {
    log.error(
      { orderId: claimed.orderId, purpose: claimed.purpose, err },
      'Payment outcome FAILED after money captured',
    );
    claimed.message = `paid_but_outcome_failed: ${(err as Error).message}`.slice(0, 300);
    await claimed.save();
  }

  return { redirectUrl: resultRedirect(successParams(claimed, trackId)) };
}

/**
 * Run the business effect of a settled payment, by purpose:
 *  - wallet_topup        → credit the wallet ledger (once).
 *  - plan_purchase       → activate the stylist's subscription tier.
 *  - reservation_deposit → confirm the held (pending) reservation.
 * The reservation module is imported lazily to avoid a static import cycle.
 */
async function applyPaymentOutcome(claimed: IPaymentTransaction, trackId: string): Promise<void> {
  const meta = (claimed.meta ?? {}) as Record<string, unknown>;

  if (claimed.purpose === 'wallet_topup') {
    const { transaction } = await applyWalletChange(String(claimed.userId), {
      type: 'credit',
      amount: claimed.amountToman,
      reason: 'topup',
      meta: { paymentTxId: String(claimed._id), trackId, refNumber: claimed.refNumber, orderId: claimed.orderId },
    });
    claimed.walletTxId = transaction._id;
    await claimed.save();
    return;
  }

  if (claimed.purpose === 'plan_purchase') {
    const tier = meta.planTier;
    if (tier === 'silver' || tier === 'gold') {
      await activatePlan(String(claimed.userId), tier as PurchasablePlan);
    }
    return;
  }

  if (claimed.purpose === 'reservation_deposit') {
    const reservationId = meta.reservationId;
    if (typeof reservationId === 'string') {
      const { confirmPaidReservation } = await import(
        '../reservation/reservation.customer.service'
      );
      await confirmPaidReservation(reservationId, {
        paymentTxId: String(claimed._id),
        refNumber: claimed.refNumber,
      });
    }
    return;
  }
}

/**
 * Release the slot held by an unpaid reservation when its payment fails, is
 * canceled, or is left unverified-then-failed. No-op for non-reservation
 * payments and for reservations that are already confirmed.
 */
async function releaseReservationHold(tx: IPaymentTransaction): Promise<void> {
  if (tx.purpose !== 'reservation_deposit') return;
  const reservationId = (tx.meta as Record<string, unknown> | null)?.reservationId;
  if (typeof reservationId !== 'string') return;
  try {
    const { releaseUnpaidReservation } = await import(
      '../reservation/reservation.customer.service'
    );
    await releaseUnpaidReservation(reservationId);
  } catch (err) {
    log.error({ orderId: tx.orderId, err }, 'Failed to release reservation hold');
  }
}
