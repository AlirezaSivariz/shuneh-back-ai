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

export interface PaymentProvider {
  recordTip(input: { customerId: string; stylistId: string; amount: number }): Promise<TipChargeResult>;
}

class StubPaymentProvider implements PaymentProvider {
  async recordTip(): Promise<TipChargeResult> {
    // TODO(payments): integrate the real gateway here. On a successful charge,
    // return { status: 'paid', reference } and the Tip will be marked paid.
    return { status: 'recorded', reference: null };
  }
}

export const paymentProvider: PaymentProvider = new StubPaymentProvider();
