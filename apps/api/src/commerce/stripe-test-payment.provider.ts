import { createHmac, timingSafeEqual } from 'node:crypto';
import type { AppConfig } from '@flyseri/config';
import type { PaymentProvider, VerifiedPaymentEvent } from './payment-provider.js';

const stripeApi = 'https://api.stripe.com/v1';
const zeroDecimal = new Set(['BIF', 'CLP', 'DJF', 'GNF', 'JPY', 'KMF', 'KRW', 'MGA', 'PYG', 'RWF', 'VND', 'VUV', 'XAF', 'XOF', 'XPF']);
const amountPattern = /^(?:0|[1-9][0-9]{0,7})(?:\.[0-9]{1,2})?$/;
const sessionPattern = /^cs_test_[A-Za-z0-9]+$/;

interface StripeSession {
  id?: unknown;
  object?: unknown;
  livemode?: unknown;
  mode?: unknown;
  client_reference_id?: unknown;
  url?: unknown;
  amount_total?: unknown;
  currency?: unknown;
  status?: unknown;
  payment_status?: unknown;
}

export class StripeVerificationError extends Error {}
export class StripeWebhookUnavailableError extends Error {}

function minorAmount(amount: string, currency: string): number {
  if (!amountPattern.test(amount) || !/^[A-Z]{3}$/.test(currency)) throw new Error('Invalid checkout amount');
  const [whole, fraction = ''] = amount.split('.');
  if (zeroDecimal.has(currency) && fraction && Number(fraction) !== 0) throw new Error('Fractional zero-decimal currency');
  const units = zeroDecimal.has(currency) ? BigInt(whole!) : BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
  if (units <= 0n || units > 99_999_999n) throw new Error('Checkout amount outside supported range');
  return Number(units);
}

function eventFromSession(session: StripeSession, eventId: string, forceFailure = false): VerifiedPaymentEvent {
  if (session.object !== 'checkout.session' || session.livemode !== false || session.mode !== 'payment' ||
      typeof session.id !== 'string' || !sessionPattern.test(session.id) ||
      typeof session.amount_total !== 'number' || !Number.isSafeInteger(session.amount_total) || session.amount_total <= 0 ||
      typeof session.currency !== 'string' || !/^[a-z]{3}$/.test(session.currency)) {
    throw new StripeVerificationError('Invalid Stripe Checkout Session');
  }
  const currency = session.currency.toUpperCase();
  const divisor = zeroDecimal.has(currency) ? 1 : 100;
  const amount = (session.amount_total / divisor).toFixed(zeroDecimal.has(currency) ? 0 : 2);
  const status = session.status === 'complete' && session.payment_status === 'paid' ? 'SUCCEEDED'
    : forceFailure || session.status === 'expired' ? 'FAILED' : 'PENDING';
  return { providerEventId: eventId, providerPaymentId: session.id, status, amount, currency };
}

export class StripeTestPaymentProvider implements PaymentProvider {
  readonly id = 'STRIPE_TEST';
  constructor(private readonly config: AppConfig, private readonly http: typeof fetch = fetch) {
    if (!config.STRIPE_SECRET_KEY?.startsWith('sk_test_')) {
      throw new Error('Stripe test payment configuration is incomplete');
    }
  }

  private async request(path: string, init: RequestInit): Promise<StripeSession> {
    const response = await this.http(`${stripeApi}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.config.STRIPE_SECRET_KEY}`, 'Stripe-Version': '2025-06-30.basil',
        ...init.headers },
      signal: AbortSignal.timeout(12_000),
    });
    if (!response.ok) throw new Error('Stripe test API request failed');
    return await response.json() as StripeSession;
  }

  async createCheckout(input: { orderId: string; orderNumber: string; amount: string; currency: string; idempotencyKey: string }) {
    const amount = minorAmount(input.amount, input.currency);
    const returnUrl = `${this.config.WEB_ORIGIN}/app/orders/${encodeURIComponent(input.orderId)}`;
    const form = new URLSearchParams({
      mode: 'payment',
      client_reference_id: input.orderId,
      'metadata[order_id]': input.orderId,
      'metadata[order_number]': input.orderNumber,
      'line_items[0][price_data][currency]': input.currency.toLowerCase(),
      'line_items[0][price_data][unit_amount]': String(amount),
      'line_items[0][price_data][product_data][name]': `Flyseri order ${input.orderNumber}`,
      'line_items[0][quantity]': '1',
      // Omit payment_method_types: Stripe presents eligible Dashboard-enabled
      // cards, wallets and local/QR methods for this account, amount and currency.
      success_url: `${returnUrl}?checkout=returned`,
      cancel_url: `${returnUrl}?checkout=cancelled`,
    });
    const session = await this.request('/checkout/sessions', { method: 'POST', body: form,
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', 'Idempotency-Key': `flyseri:${input.idempotencyKey}` } });
    if (session.object !== 'checkout.session' || session.livemode !== false || session.mode !== 'payment' ||
        session.client_reference_id !== input.orderId || session.amount_total !== amount ||
        session.currency !== input.currency.toLowerCase() ||
        typeof session.id !== 'string' || !sessionPattern.test(session.id) || typeof session.url !== 'string' ||
        !this.isAllowedCheckoutUrl(new URL(session.url))) throw new Error('Invalid Stripe test Checkout Session');
    return { providerPaymentId: session.id, redirectUrl: session.url };
  }

  isAllowedCheckoutUrl(url: URL): boolean {
    return url.protocol === 'https:' && url.hostname === 'checkout.stripe.com' && !url.port && !url.username && !url.password;
  }

  async verifyWebhook(rawBody: Buffer, headers: Record<string, string | string[] | undefined>): Promise<VerifiedPaymentEvent | null> {
    if (!this.config.STRIPE_WEBHOOK_SECRET) throw new StripeWebhookUnavailableError('Stripe webhook signing secret is not configured');
    const signature = headers['stripe-signature'];
    if (!Buffer.isBuffer(rawBody) || typeof signature !== 'string') throw new StripeVerificationError('Missing Stripe signature');
    const parts = signature.split(',').map((part) => part.trim().split('=', 2));
    const timestamp = parts.find(([key]) => key === 't')?.[1];
    const candidates = parts.filter(([key]) => key === 'v1').map(([, value]) => value);
    if (!timestamp || !/^\d{10}$/.test(timestamp) || Math.abs(Date.now() / 1000 - Number(timestamp)) > 300) {
      throw new StripeVerificationError('Invalid Stripe signature timestamp');
    }
    const expected = createHmac('sha256', this.config.STRIPE_WEBHOOK_SECRET)
      .update(`${timestamp}.`).update(rawBody).digest();
    if (!candidates.some((candidate) => candidate && /^[0-9a-f]{64}$/i.test(candidate) &&
        timingSafeEqual(expected, Buffer.from(candidate, 'hex')))) throw new StripeVerificationError('Invalid Stripe signature');
    let payload: unknown;
    try { payload = JSON.parse(rawBody.toString('utf8')); }
    catch { throw new StripeVerificationError('Invalid Stripe event'); }
    if (!payload || typeof payload !== 'object') throw new StripeVerificationError('Invalid Stripe event');
    const event = payload as { id?: unknown; livemode?: unknown; type?: unknown; data?: { object?: StripeSession } };
    if (typeof event.id !== 'string' || !/^evt_[A-Za-z0-9]+$/.test(event.id) || event.livemode !== false) {
      throw new StripeVerificationError('Invalid Stripe test event');
    }
    if (!['checkout.session.completed', 'checkout.session.async_payment_succeeded',
      'checkout.session.async_payment_failed', 'checkout.session.expired'].includes(String(event.type))) return null;
    if (!event.data?.object) throw new StripeVerificationError('Missing Stripe Checkout Session');
    return eventFromSession(event.data.object, event.id,
      event.type === 'checkout.session.async_payment_failed' || event.type === 'checkout.session.expired');
  }

  async getStatus(providerPaymentId: string): Promise<VerifiedPaymentEvent | null> {
    if (!sessionPattern.test(providerPaymentId)) throw new StripeVerificationError('Invalid Stripe Checkout Session ID');
    const session = await this.request(`/checkout/sessions/${encodeURIComponent(providerPaymentId)}`, { method: 'GET' });
    const event = eventFromSession(session, `stripe-status:${providerPaymentId}:${session.payment_status}:${session.status}`);
    if (event.providerPaymentId !== providerPaymentId) throw new StripeVerificationError('Stripe Checkout Session mismatch');
    return event;
  }

  async resumeCheckout(input: { providerPaymentId: string; orderId: string; amount: string; currency: string }) {
    if (!sessionPattern.test(input.providerPaymentId)) throw new StripeVerificationError('Invalid Stripe Checkout Session ID');
    const session = await this.request(`/checkout/sessions/${encodeURIComponent(input.providerPaymentId)}`, { method: 'GET' });
    const event = eventFromSession(session, `stripe-status:${input.providerPaymentId}:${session.payment_status}:${session.status}`);
    if (event.providerPaymentId !== input.providerPaymentId || session.client_reference_id !== input.orderId ||
        session.amount_total !== minorAmount(input.amount, input.currency) || session.currency !== input.currency.toLowerCase()) throw new StripeVerificationError('Checkout does not match this order');
    let redirectUrl: string | null = null;
    if (session.status === 'open' && session.payment_status === 'unpaid' && typeof session.url === 'string' && this.isAllowedCheckoutUrl(new URL(session.url))) redirectUrl = session.url;
    return { event, redirectUrl };
  }
}
