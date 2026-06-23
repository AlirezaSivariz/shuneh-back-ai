/**
 * Payment interface (STUB). There is NO real payment gateway yet, but all money
 * movement (tips today; bookings/promotions later) goes through this seam so a
 * real provider (Zarinpal, IDPay, Stripe, …) can be dropped in without touching
 * business logic.
 *
 * `recordTip` currently just acknowledges the intent and returns status
 * 'recorded' — no money actually moves.
 */
export interface TipChargeResult {
  status: 'pending' | 'paid' | 'recorded';
  /** Set once a real gateway returns a reference. Null in the stub. */
  reference: string | null;
}

/**
 * Result of STARTING a wallet top-up. With a real gateway this would carry a
 * `paymentUrl` to redirect the user to; the stub returns nulls and 'pending'.
 */
export interface TopupInitResult {
  status: 'pending' | 'paid';
  /** Gateway redirect URL once integrated; null in the stub. */
  paymentUrl: string | null;
  reference: string | null;
}

export interface PaymentProvider {
  recordTip(input: { customerId: string; stylistId: string; amount: number }): Promise<TipChargeResult>;
  /** Begin a wallet top-up of `amount` Toman for `userId`. */
  startWalletTopup(input: { userId: string; amount: number }): Promise<TopupInitResult>;
}

class StubPaymentProvider implements PaymentProvider {
  async recordTip(): Promise<TipChargeResult> {
    // TODO(payments): integrate the real gateway here. On a successful charge,
    // return { status: 'paid', reference } and the Tip will be marked paid.
    return { status: 'recorded', reference: null };
  }

  async startWalletTopup(): Promise<TopupInitResult> {
    // TODO(payments): integrate the real gateway (e.g. Zarinpal) HERE.
    //   1) request a payment with `amount` → get { authority/paymentUrl }.
    //   2) return { status: 'pending', paymentUrl, reference: authority }.
    //   3) on the gateway callback/verify, flip the pending WalletTransaction to
    //      'completed' and credit the balance via wallet.service.applyWalletChange.
    // Until then no money moves: the top-up stays 'pending' and the balance is
    // unchanged.
    return { status: 'pending', paymentUrl: null, reference: null };
  }
}

export const paymentProvider: PaymentProvider = new StubPaymentProvider();
