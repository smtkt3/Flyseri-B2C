import { createHmac } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import { parseConfig } from '@flyseri/config';
import { StripeTestPaymentProvider, StripeVerificationError } from './stripe-test-payment.provider.js';

const config = parseConfig({ PAYMENT_PROVIDER: 'STRIPE_TEST', PAYMENT_CHECKOUT_ENABLED: 'true',
  STRIPE_SECRET_KEY: 'sk_test_example', STRIPE_WEBHOOK_SECRET: 'whsec_example' });
const session = { id: 'cs_test_example', object: 'checkout.session', livemode: false, mode: 'payment',
  client_reference_id: 'order-1', amount_total: 128050, currency: 'myr', status: 'complete', payment_status: 'paid',
  url: 'https://checkout.stripe.com/c/pay/cs_test_example' };

describe('Stripe sandbox adapter', () => {
  it('creates a test Checkout Session with the server amount and idempotency key', async () => {
    const http = vi.fn(async () => new Response(JSON.stringify(session), { status: 200 })) as unknown as typeof fetch;
    const provider = new StripeTestPaymentProvider(config, http);
    const checkout = await provider.createCheckout({ orderId: 'order-1', orderNumber: 'SMO-123',
      amount: '1280.50', currency: 'MYR', idempotencyKey: 'once-1' });
    expect(checkout).toEqual({ providerPaymentId: session.id, redirectUrl: session.url });
    const [url, init] = vi.mocked(http).mock.calls[0]!;
    expect(url).toBe('https://api.stripe.com/v1/checkout/sessions');
    expect((init?.headers as Record<string, string>)['Idempotency-Key']).toBe('flyseri:once-1');
    const body = init?.body as URLSearchParams;
    expect(body.get('line_items[0][price_data][unit_amount]')).toBe('128050');
    expect(body.get('client_reference_id')).toBe('order-1');
    expect(body.has('payment_method_types[0]')).toBe(false);
    expect(provider.isAllowedCheckoutUrl(new URL('https://evil.example/pay'))).toBe(false);
  });

  it('verifies the raw webhook signature and maps only the authenticated session amount', async () => {
    const provider = new StripeTestPaymentProvider(config);
    const body = Buffer.from(JSON.stringify({ id: 'evt_example', livemode: false, type: 'checkout.session.completed',
      data: { object: session } }));
    const timestamp = String(Math.floor(Date.now() / 1000));
    const signature = createHmac('sha256', config.STRIPE_WEBHOOK_SECRET!).update(`${timestamp}.`).update(body).digest('hex');
    const event = await provider.verifyWebhook(body, { 'stripe-signature': `t=${timestamp},v1=${signature}` });
    expect(event).toEqual({ providerEventId: 'evt_example', providerPaymentId: session.id,
      status: 'SUCCEEDED', amount: '1280.50', currency: 'MYR' });
    await expect(provider.verifyWebhook(Buffer.from('changed'), { 'stripe-signature': `t=${timestamp},v1=${signature}` }))
      .rejects.toBeInstanceOf(StripeVerificationError);
    await expect(provider.verifyWebhook(body, { 'stripe-signature': `t=${Number(timestamp) - 1000},v1=${signature}` }))
      .rejects.toBeInstanceOf(StripeVerificationError);
  });

  it('checks Stripe status without treating an open or unpaid Session as paid', async () => {
    const pending = { ...session, status: 'open', payment_status: 'unpaid' };
    const http = vi.fn(async () => new Response(JSON.stringify(pending), { status: 200 })) as unknown as typeof fetch;
    const provider = new StripeTestPaymentProvider(config, http);
    expect((await provider.getStatus(session.id))?.status).toBe('PENDING');
    vi.mocked(http).mockImplementation(async () => new Response(JSON.stringify(session), { status: 200 }));
    expect((await provider.getStatus(session.id))?.status).toBe('SUCCEEDED');
  });

  it('uses authenticated status lookup when the optional webhook is not configured', async () => {
    const statusOnly = parseConfig({ PAYMENT_PROVIDER: 'STRIPE_TEST', PAYMENT_CHECKOUT_ENABLED: 'true',
      STRIPE_SECRET_KEY: 'sk_test_example' });
    const http = vi.fn(async () => new Response(JSON.stringify(session), { status: 200 })) as unknown as typeof fetch;
    const provider = new StripeTestPaymentProvider(statusOnly, http);
    expect((await provider.getStatus(session.id))?.status).toBe('SUCCEEDED');
    await expect(provider.verifyWebhook(Buffer.from('{}'), {})).rejects.toThrow('webhook signing secret is not configured');
  });
});
