import { Inject, Injectable } from '@nestjs/common';
import type { PaymentStartResult } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { COMMERCE_REPOSITORY, PAYMENT_PROVIDER } from '../tokens.js';
import { CommerceRepository, OrderConflictError, OrderUnavailableError, PaymentVerificationError } from './commerce.repository.js';
import type { PaymentProvider } from './payment-provider.js';
import { StripeVerificationError, StripeWebhookUnavailableError } from './stripe-test-payment.provider.js';

@Injectable()
export class PaymentEngineService {
  constructor(@Inject(COMMERCE_REPOSITORY) private readonly repository: CommerceRepository | undefined,
    @Inject(PAYMENT_PROVIDER) private readonly provider: PaymentProvider | undefined) {}
  available(): boolean { return Boolean(this.provider && this.repository); }
  providerId(): string | null { return this.provider?.id ?? null; }
  async start(customerId: string, orderId: string, idempotencyKey: string): Promise<PaymentStartResult> {
    if (!this.provider || !this.repository) throw new ApiException('DEPENDENCY_UNAVAILABLE',
      'Online payment is not available yet. Your order has not been charged.', 503);
    let reservation;
    try { reservation = await this.repository.reservePayment(customerId, orderId, this.provider.id, idempotencyKey); }
    catch (error) {
      if (error instanceof OrderUnavailableError) throw new ApiException('NOT_FOUND', 'We could not find that order.', 404);
      if (error instanceof OrderConflictError) throw new ApiException('CONFLICT', 'This order needs a fresh fare before payment.', 409);
      throw error;
    }
    if (!reservation.created) {
      let payment = await this.repository.payment(customerId, reservation.paymentId);
      if (!payment) throw new Error('Reserved payment missing');
      const candidate = await this.repository.reconciliationCandidate(payment.id);
      if (candidate?.provider === this.provider.id && candidate.providerPaymentId && this.provider.resumeCheckout) {
        try {
          const checkout = await this.provider.resumeCheckout({ providerPaymentId: candidate.providerPaymentId, orderId,
            amount: reservation.amount, currency: reservation.currency });
          if (checkout.event.status !== 'PENDING') await this.repository.applyVerifiedEvent(this.provider.id, payment.id, checkout.event, 'checkout-resume');
          payment = await this.repository.payment(customerId, payment.id);
          if (!payment) throw new Error('Checkout payment missing');
          if (checkout.redirectUrl && ['PENDING','PROCESSING'].includes(payment.status) && this.provider.isAllowedCheckoutUrl(new URL(checkout.redirectUrl))) return { payment, redirectUrl: checkout.redirectUrl, actionRequired: true };
        } catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Your existing checkout could not be verified. Check its status before trying again.', 503); }
      }
      return { payment, redirectUrl: null, actionRequired: false };
    }
    try {
      const checkout = await this.provider.createCheckout({ orderId, orderNumber: reservation.orderNumber,
        amount: reservation.amount, currency: reservation.currency, idempotencyKey });
      const url = new URL(checkout.redirectUrl);
      if (!checkout.providerPaymentId || url.protocol !== 'https:' || !this.provider.isAllowedCheckoutUrl(url)) {
        throw new Error('Invalid provider checkout');
      }
      await this.repository.checkoutCreated(reservation.paymentId, reservation.attemptId, checkout.providerPaymentId);
      const payment = await this.repository.payment(customerId, reservation.paymentId);
      if (!payment) throw new Error('Checkout payment missing');
      return { payment, redirectUrl: checkout.redirectUrl, actionRequired: true };
    } catch {
      const latest = await this.repository.payment(customerId, reservation.paymentId);
      if (latest?.status === 'SUCCEEDED') return { payment: latest, redirectUrl: null, actionRequired: false };
      // Timeout or crash after contacting a provider is ambiguous. Never retry automatically.
      await this.repository.checkoutUnknown(reservation.paymentId, reservation.attemptId);
      throw new ApiException('DEPENDENCY_UNAVAILABLE',
        'We could not confirm the payment setup. No new attempt will be made until its status is checked.', 503);
    }
  }
  /** Future bounded worker entry point. No scheduler is registered without an approved provider adapter. */
  async reconcile(paymentId: string): Promise<'RESOLVED' | 'STILL_PENDING'> {
    if (!this.provider || !this.repository) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Payment reconciliation is unavailable.', 503);
    const candidate = await this.repository.reconciliationCandidate(paymentId);
    if (!candidate || candidate.provider !== this.provider.id || !candidate.providerPaymentId) return 'STILL_PENDING';
    const event = await this.provider.getStatus(candidate.providerPaymentId);
    if (!event || event.status === 'PENDING') {
      await this.repository.reconciliationChecked(paymentId);
      return 'STILL_PENDING';
    }
    await this.repository.applyVerifiedEvent(this.provider.id, paymentId, event, 'reconciliation');
    return 'RESOLVED';
  }

  async handleWebhook(rawBody: Buffer | undefined, headers: Record<string, string | string[] | undefined>, requestId: string): Promise<void> {
    if (!this.provider || !this.repository) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Payment verification is unavailable.', 503);
    if (!rawBody) throw new ApiException('VALIDATION_ERROR', 'Missing webhook body.', 400);
    let event;
    try { event = await this.provider.verifyWebhook(rawBody, headers); }
    catch (error) {
      if (error instanceof StripeWebhookUnavailableError) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Payment webhook is not configured.', 503);
      if (error instanceof StripeVerificationError) throw new ApiException('VALIDATION_ERROR', 'Invalid payment event signature or payload.', 400);
      throw error;
    }
    if (!event) return;
    const paymentId = await this.repository.paymentIdByProviderReference(this.provider.id, event.providerPaymentId);
    // The event can arrive before the Checkout Session reference is persisted. Ask Stripe to retry.
    if (!paymentId) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Payment record is not ready.', 503);
    try { await this.repository.applyVerifiedEvent(this.provider.id, paymentId, event, requestId); }
    catch (error) {
      if (error instanceof PaymentVerificationError) throw new ApiException('VALIDATION_ERROR', 'Payment event did not match the order.', 400);
      throw error;
    }
  }
}
