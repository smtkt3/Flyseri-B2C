/** A provider adapter must be backed by an approved, tested provider contract. */
export interface PaymentProvider {
  readonly id: string;
  createCheckout(input: {
    orderId: string;
    orderNumber: string;
    amount: string;
    currency: string;
    idempotencyKey: string;
  }): Promise<{ providerPaymentId: string; redirectUrl: string }>;
  isAllowedCheckoutUrl(url: URL): boolean;
  verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<VerifiedPaymentEvent | null>;
  getStatus(providerPaymentId: string): Promise<VerifiedPaymentEvent | null>;
  resumeCheckout?(input: { providerPaymentId: string; orderId: string; amount: string; currency: string }): Promise<{ event: VerifiedPaymentEvent; redirectUrl: string | null }>;
}

export interface VerifiedPaymentEvent {
  providerEventId: string;
  providerPaymentId: string;
  status: 'SUCCEEDED' | 'FAILED' | 'PENDING';
  amount: string;
  currency: string;
}
