import { cents as extraCents, fromCents as extraFromCents, requestKey, type AncillarySnapshot } from '../flight/ancillary-purchase.contract.js';
import { randomBytes } from 'node:crypto';
import { and, asc, desc, eq, inArray, isNotNull, isNull } from 'drizzle-orm';
import { auditEvents, commerceAuditEvents, commerceOutbox, flightBookingIntents, flightBookings, orderItems, orders,
  paymentAttempts, paymentEvents, payments, visaAssistanceRequests, visaAssistanceRequestTravellers, visaAssistanceFeeSettings, visaApplications, visaStatusHistory, type DatabaseConnection } from '@flyseri/database';
import type { OrderDetail, OrderItem, OrderSummary, PaymentSummary } from '@flyseri/types';
import type { VerifiedPaymentEvent } from './payment-provider.js';

const amountPattern = /^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/;
export class OrderUnavailableError extends Error {}
export class OrderConflictError extends Error {}
export class PaymentVerificationError extends Error {}
export interface PaymentReservation { paymentId: string; attemptId: string; created: boolean; amount: string; currency: string; orderNumber: string }
const money = (amount: string) => {
  const [whole, fraction = ''] = amount.split('.');
  return `${whole}.${fraction.padEnd(2, '0')}`;
};
const positiveMoney = (amount: string) => amountPattern.test(amount) && BigInt(amount.replace('.', '')) > 0n;
const centsFor = (amount: string) => {
  if (!/^(?:0|[1-9][0-9]{0,15})(?:\.[0-9]{1,2})?$/.test(amount)) throw new OrderConflictError();
  const [whole, fraction = ''] = amount.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
};
const fromCents = (amount: bigint) => `${amount / 100n}.${String(amount % 100n).padStart(2, '0')}`;
type OrderRow = typeof orders.$inferSelect;
type PaymentRow = typeof payments.$inferSelect;

export function presentOrder(row: OrderRow): OrderSummary {
  const status = row.expiresAt && row.expiresAt <= new Date() && ['PENDING_PAYMENT', 'PAYMENT_FAILED'].includes(row.status)
    ? 'EXPIRED' : row.status;
  return { id: row.id, orderNumber: row.orderNumber, tripId: row.tripId, bookingIntentId: row.bookingIntentId, visaApplicationId: row.visaApplicationId,
    status: status as OrderSummary['status'], fulfillmentStatus: row.fulfillmentStatus as OrderSummary['fulfillmentStatus'],
    currency: row.currency, totalAmount: row.totalAmount, expiresAt: row.expiresAt?.toISOString() ?? null,
    paidAt: row.paidAt?.toISOString() ?? null, createdAt: row.createdAt.toISOString() };
}
export function presentPayment(row: PaymentRow): PaymentSummary {
  return { id: row.id, provider: row.provider, orderId: row.orderId, status: row.status as PaymentSummary['status'],
    reconciliationState: row.reconciliationState as PaymentSummary['reconciliationState'], amount: row.amount,
    currency: row.currency, createdAt: row.createdAt.toISOString(), paidAt: row.paidAt?.toISOString() ?? null };
}
export class CommerceRepository {
  constructor(readonly connection: DatabaseConnection) {}

  async createFlightOrder(customerId: string, intentId: string, requestId: string): Promise<OrderDetail> {
    const id = await this.connection.db.transaction(async (tx) => {
      const [intent] = await tx.select().from(flightBookingIntents)
        .where(and(eq(flightBookingIntents.id, intentId), eq(flightBookingIntents.customerId, customerId))).for('update').limit(1);
      if (!intent) throw new OrderUnavailableError();
      const [prior] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.bookingIntentId, intentId)).limit(1);
      if (prior) return prior.id;
      if (intent.status !== 'READY_FOR_PAYMENT' || !intent.expiresAt || intent.expiresAt <= new Date() ||
          !intent.validatedTotalAmount || !positiveMoney(intent.validatedTotalAmount)) {
        throw new OrderConflictError();
      }
      // A validated shopping price is not a reservation. Payment orders require a persisted Sabre PNR.
      const [booking] = await tx.select({ status: flightBookings.status, pnrLocator: flightBookings.pnrLocator })
        .from(flightBookings).where(and(eq(flightBookings.bookingIntentId, intentId), eq(flightBookings.customerId, customerId))).limit(1);
      if (!booking?.pnrLocator || !['PNR_CREATED', 'AWAITING_PAYMENT'].includes(booking.status)) throw new OrderConflictError();
      const extrasSnapshot = intent.searchRequestSnapshot as AncillarySnapshot;
      const extraPurchase = extrasSnapshot.checkoutAncillaryPurchase;
      if (extrasSnapshot.checkoutAncillaryRequests?.length && (!extraPurchase || !['CONFIRMED', 'SKIPPED'].includes(extraPurchase.status))) throw new OrderConflictError();
      if (extraPurchase && extraPurchase.requestKey !== requestKey(extrasSnapshot.checkoutAncillaryRequests ?? [])) throw new OrderConflictError();
      if (extraPurchase?.status === 'CONFIRMED' && (!extraPurchase.items.length || !Number.isFinite(Date.parse(extraPurchase.expiresAt)) || extraCents(extraPurchase.totalAmount) !== extraCents(extraPurchase.airfareAmount) + extraCents(extraPurchase.extrasAmount) || extraPurchase.items.length !== extrasSnapshot.checkoutAncillaryRequests?.length || new Set(extraPurchase.items.map(item => item.requestId)).size !== extraPurchase.items.length || extraPurchase.items.some(item => !extrasSnapshot.checkoutAncillaryRequests?.some(request => request.id === item.requestId)))) throw new OrderConflictError();
      if (extraPurchase?.status === 'CONFIRMED' && (extraPurchase.currency !== intent.currency || extraCents(extraPurchase.airfareAmount) !== extraCents(intent.validatedTotalAmount) || Date.parse(extraPurchase.expiresAt) <= Date.now() || extraPurchase.items.some(item => !item.providerAncillaryIds.length) || extraCents(extraPurchase.extrasAmount) !== extraPurchase.items.reduce((sum, item) => sum + extraCents(item.checkoutAmount), 0n))) throw new OrderConflictError();
      const airfare = money(intent.validatedTotalAmount);
      const total = extraPurchase?.status === 'CONFIRMED' ? extraFromCents(extraCents(airfare) + extraCents(extraPurchase.extrasAmount)) : airfare;
      const search = intent.searchRequestSnapshot as { origin?: unknown; destination?: unknown };
      const from = typeof search.origin === 'string' && /^[A-Z]{3}$/.test(search.origin) ? search.origin : 'departure';
      const to = typeof search.destination === 'string' && /^[A-Z]{3}$/.test(search.destination) ? search.destination : 'destination';
      const [created] = await tx.insert(orders).values({ customerId, tripId: intent.tripId, bookingIntentId: intent.id,
        orderNumber: `SMO-${randomBytes(10).toString('hex').toUpperCase()}`, currency: intent.currency,
        subtotalAmount: total, totalAmount: total, expiresAt: intent.expiresAt }).returning({ id: orders.id });
      if (!created) throw new Error('Order insertion failed');
      await tx.insert(orderItems).values({ orderId: created.id, itemType: 'FLIGHT', referenceId: intent.id,
        descriptionSnapshot: `Flight ${from} to ${to}`, quantity: 1, unitAmount: airfare, totalAmount: airfare, currency: intent.currency });
      if (extraPurchase?.status === 'CONFIRMED') await tx.insert(orderItems).values(extraPurchase.items.map(item => ({ orderId: created.id, itemType: 'FLIGHT', referenceId: intent.id, descriptionSnapshot: ('Airline extra: ' + item.name + ' - ' + item.segmentLabels.join(' / ') + ' - Traveler ' + item.passengerIndexes.map(index => index + 1).join(', ')).slice(0,240), quantity: 1, unitAmount: item.checkoutAmount, totalAmount: item.checkoutAmount, currency: intent.currency })));
      await tx.insert(commerceAuditEvents).values({ actorType: 'CUSTOMER', actorCustomerId: customerId,
        orderId: created.id, event: 'order.created', requestId });
      await tx.insert(commerceOutbox).values({ eventType: 'order.created', orderId: created.id });
      return created.id;
    });
    const result = await this.detail(customerId, id);
    if (!result) throw new Error('Created order missing');
    return result;
  }

  // Existing order items carry the request reference; the request lock prevents duplicate orders.
  async createAssistanceOrder(customerId: string, assistanceId: string, requestId: string): Promise<OrderDetail> {
    const id = await this.connection.db.transaction(async tx => {
      const [request] = await tx.select().from(visaAssistanceRequests).where(and(eq(visaAssistanceRequests.id, assistanceId), eq(visaAssistanceRequests.customerId, customerId))).for('update');
      if (!request) throw new OrderUnavailableError();
      const [prior] = await tx.select({id: orders.id}).from(orders).innerJoin(orderItems, eq(orderItems.orderId, orders.id)).where(and(eq(orderItems.referenceId, assistanceId), eq(orderItems.itemType, 'VISA_SERVICE'), eq(orders.customerId, customerId), isNull(orders.visaApplicationId), isNull(orders.bookingIntentId))).limit(1);
      if (prior) return prior.id;
      const people = await tx.select().from(visaAssistanceRequestTravellers).where(eq(visaAssistanceRequestTravellers.requestId, assistanceId));
      const [fee] = await tx.select().from(visaAssistanceFeeSettings).where(and(eq(visaAssistanceFeeSettings.id, 'default'), eq(visaAssistanceFeeSettings.active, true))).limit(1);
      if (request.status !== 'NEW' || !people.length || people.some(p => !p.applicantDetails) || !fee || !positiveMoney(fee.amount)) throw new OrderConflictError();
      const quantity = fee.basis === 'APPLICANT' ? people.length : 1;
      const unit = money(fee.amount), total = fromCents(centsFor(unit) * BigInt(quantity));
      const [created] = await tx.insert(orders).values({customerId,tripId:request.tripId,orderNumber:`SMVA-${randomBytes(10).toString('hex').toUpperCase()}`,currency:fee.currency,subtotalAmount:total,totalAmount:total}).returning({id:orders.id});
      if (!created) throw new Error('Order insertion failed');
      await tx.insert(orderItems).values({orderId:created.id,itemType:'VISA_SERVICE',referenceId:assistanceId,descriptionSnapshot:`Flyseri assisted visa service · ${request.requestReference}`,quantity,unitAmount:unit,totalAmount:total,currency:fee.currency});
      await tx.insert(commerceAuditEvents).values({actorType:'CUSTOMER',actorCustomerId:customerId,orderId:created.id,event:'visa.assistance.payment.started',requestId});
      return created.id;
    });
    const result = await this.detail(customerId, id);
    if (!result) throw new Error('Created order missing');
    return result;
  }

  async createVisaOrder(customerId: string, applicationId: string, requestId: string): Promise<OrderDetail> {
    const id = await this.connection.db.transaction(async (tx) => {
      const [application] = await tx.select().from(visaApplications)
        .where(and(eq(visaApplications.id, applicationId), eq(visaApplications.customerId, customerId), isNull(visaApplications.archivedAt)))
        .for('update').limit(1);
      if (!application) throw new OrderUnavailableError();
      const [prior] = await tx.select({ id: orders.id }).from(orders).where(eq(orders.visaApplicationId, applicationId)).limit(1);
      if (prior) return prior.id;
      if (!['SUBMITTED', 'AWAITING_PAYMENT', 'PAYMENT_FAILED'].includes(application.status) ||
          !application.declarationAcceptedAt || !application.submittedAt) throw new OrderConflictError();
      const fees = application.feeSnapshot as Array<{ code?: unknown; label?: unknown; amount?: unknown; currency?: unknown }>;
      if (!Array.isArray(fees) || !fees.length) throw new OrderConflictError();
      const currency = fees[0]?.currency;
      if (typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) throw new OrderConflictError();
      const normalized = fees.map((fee) => {
        if (typeof fee.code !== 'string' || typeof fee.label !== 'string' || fee.currency !== currency || typeof fee.amount !== 'string') throw new OrderConflictError();
        return { code: fee.code, label: fee.label.slice(0, 240), amount: fromCents(centsFor(fee.amount)) };
      });
      const totalCents = normalized.reduce((sum, fee) => sum + centsFor(fee.amount), 0n);
      if (totalCents <= 0n) throw new OrderConflictError();
      const total = fromCents(totalCents);
      const [created] = await tx.insert(orders).values({ customerId, tripId: application.tripId, visaApplicationId: application.id,
        orderNumber: `SMV-${randomBytes(10).toString('hex').toUpperCase()}`, currency,
        subtotalAmount: total, totalAmount: total }).returning({ id: orders.id });
      if (!created) throw new Error('Visa order insertion failed');
      await tx.insert(orderItems).values(normalized.map((fee) => ({ orderId: created.id,
        itemType: fee.code === 'GOVERNMENT_FEE' ? 'VISA_SERVICE' as const : 'SERVICE_FEE' as const,
        referenceId: application.id, descriptionSnapshot: fee.label, quantity: 1,
        unitAmount: fee.amount, totalAmount: fee.amount, currency })));
      await tx.update(visaApplications).set({ status: 'AWAITING_PAYMENT', updatedAt: new Date() }).where(eq(visaApplications.id, application.id));
      await tx.insert(visaStatusHistory).values({ applicationId, fromStatus: application.status, toStatus: 'AWAITING_PAYMENT',
        actorType: 'CUSTOMER', actorCustomerId: customerId });
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: application.tripId, visaApplicationId: applicationId, event: 'visa.payment.started' });
      await tx.insert(commerceAuditEvents).values({ actorType: 'CUSTOMER', actorCustomerId: customerId, orderId: created.id,
        event: 'order.created', requestId });
      await tx.insert(commerceOutbox).values({ eventType: 'order.created', orderId: created.id });
      return created.id;
    });
    const result = await this.detail(customerId, id);
    if (!result) throw new Error('Created visa order missing');
    return result;
  }

  async list(customerId: string): Promise<OrderSummary[]> {
    const rows = await this.connection.db.select().from(orders).where(eq(orders.customerId, customerId))
      .orderBy(desc(orders.createdAt)).limit(50);
    return rows.map(presentOrder);
  }
  async detail(customerId: string, id: string): Promise<OrderDetail | null> {
    const [row] = await this.connection.db.select().from(orders)
      .where(and(eq(orders.customerId, customerId), eq(orders.id, id))).limit(1);
    if (!row) return null;
    const [items, paymentRows, bookingRows] = await Promise.all([
      this.connection.db.select().from(orderItems).where(eq(orderItems.orderId, id)),
      this.connection.db.select().from(payments).where(eq(payments.orderId, id)).limit(1),
      row.bookingIntentId ? this.connection.db.select({ id: flightBookings.id }).from(flightBookings)
        .where(and(eq(flightBookings.bookingIntentId, row.bookingIntentId), eq(flightBookings.customerId, customerId))).limit(1) : Promise.resolve([]),
    ]);
    return { ...presentOrder(row), flightBookingId: bookingRows[0]?.id ?? null, visaAssistanceRequestId: !row.visaApplicationId && !row.bookingIntentId ? items.find(item => item.itemType === 'VISA_SERVICE')?.referenceId ?? null : null, items: items.map((item): OrderItem => ({ id: item.id,
      itemType: item.itemType as OrderItem['itemType'], description: item.descriptionSnapshot,
      quantity: item.quantity, unitAmount: item.unitAmount, totalAmount: item.totalAmount, currency: item.currency })),
      payment: paymentRows[0] ? presentPayment(paymentRows[0]) : null };
  }
  async payments(customerId: string): Promise<PaymentSummary[]> {
    const rows = await this.connection.db.select().from(payments).where(eq(payments.customerId, customerId))
      .orderBy(desc(payments.createdAt)).limit(50);
    return rows.map(presentPayment);
  }
  async payment(customerId: string, id: string): Promise<PaymentSummary | null> {
    const [row] = await this.connection.db.select().from(payments)
      .where(and(eq(payments.customerId, customerId), eq(payments.id, id))).limit(1);
    return row ? presentPayment(row) : null;
  }

  async reservePayment(customerId: string, orderId: string, provider: string, idempotencyKey: string): Promise<PaymentReservation> {
    return this.connection.db.transaction(async (tx) => {
      const [order] = await tx.select().from(orders).where(and(eq(orders.id, orderId), eq(orders.customerId, customerId)))
        .for('update').limit(1);
      if (!order) throw new OrderUnavailableError();
      if (!['PENDING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_PROCESSING'].includes(order.status) ||
          order.expiresAt && order.expiresAt <= new Date()) throw new OrderConflictError();
      if (order.visaApplicationId) {
        const [application] = await tx.select({ status: visaApplications.status }).from(visaApplications)
          .where(and(eq(visaApplications.id, order.visaApplicationId), eq(visaApplications.customerId, customerId), isNull(visaApplications.archivedAt))).limit(1);
        if (!application || !['AWAITING_PAYMENT', 'PAYMENT_FAILED', 'PAYMENT_CONFIRMING'].includes(application.status)) throw new OrderConflictError();
      } else if (!order.bookingIntentId) {
        const [source] = await tx.select({status:visaAssistanceRequests.status}).from(orderItems).innerJoin(visaAssistanceRequests, eq(visaAssistanceRequests.id, orderItems.referenceId)).where(and(eq(orderItems.orderId, order.id), eq(orderItems.itemType, 'VISA_SERVICE'), eq(visaAssistanceRequests.customerId, customerId))).limit(1);
        if (source?.status !== 'NEW') throw new OrderConflictError();
      } else {
        if (!order.bookingIntentId || !order.expiresAt) throw new OrderConflictError();
        const [booking] = await tx.select({ status: flightBookings.status, pnrLocator: flightBookings.pnrLocator })
          .from(flightBookings).where(and(eq(flightBookings.bookingIntentId, order.bookingIntentId), eq(flightBookings.customerId, customerId))).limit(1);
        if (!booking?.pnrLocator || !['PNR_CREATED', 'AWAITING_PAYMENT', 'PAYMENT_PENDING'].includes(booking.status)) throw new OrderConflictError();
      }
      let [payment] = await tx.select().from(payments).where(eq(payments.orderId, orderId)).limit(1);
      if (payment && (payment.customerId !== customerId || payment.provider !== provider ||
          payment.amount !== order.totalAmount || payment.currency !== order.currency || payment.status === 'SUCCEEDED')) {
        throw new OrderConflictError();
      }
      if (!payment) {
        [payment] = await tx.insert(payments).values({ orderId, customerId, provider, amount: order.totalAmount,
          currency: order.currency, reconciliationState: 'REQUIRED' }).returning();
      }
      if (!payment) throw new Error('Payment reservation failed');
      const [sameKey] = await tx.select().from(paymentAttempts).where(and(eq(paymentAttempts.paymentId, payment.id),
        eq(paymentAttempts.idempotencyKey, idempotencyKey))).limit(1);
      if (sameKey) return { paymentId: payment.id, attemptId: sameKey.id, created: false, amount: payment.amount,
        currency: payment.currency, orderNumber: order.orderNumber };
      const [active] = await tx.select().from(paymentAttempts).where(and(eq(paymentAttempts.paymentId, payment.id),
        inArray(paymentAttempts.status, ['CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN']))).limit(1);
      if (active) return { paymentId: payment.id, attemptId: active.id, created: false, amount: payment.amount,
        currency: payment.currency, orderNumber: order.orderNumber };
      const [attempt] = await tx.insert(paymentAttempts).values({ paymentId: payment.id, idempotencyKey, provider,
        amount: payment.amount, currency: payment.currency }).returning({ id: paymentAttempts.id });
      if (!attempt) throw new Error('Payment attempt reservation failed');
      // The failed Session reference remains on its historical attempt. Clear
      // the payment's active reference before contacting Stripe so a worker
      // cannot apply the previous failure to this new attempt during setup.
      await tx.update(payments).set({ status: 'PROCESSING', providerPaymentId: null, reconciliationState: 'REQUIRED', updatedAt: new Date() })
        .where(eq(payments.id, payment.id));
      await tx.update(orders).set({ status: 'PAYMENT_PROCESSING', updatedAt: new Date() }).where(eq(orders.id, orderId));
      await tx.insert(commerceAuditEvents).values({ actorType: 'CUSTOMER', actorCustomerId: customerId,
        orderId, paymentId: payment.id, event: 'payment.attempt.created' });
      return { paymentId: payment.id, attemptId: attempt.id, created: true, amount: payment.amount,
        currency: payment.currency, orderNumber: order.orderNumber };
    });
  }
  async checkoutCreated(paymentId: string, attemptId: string, providerPaymentId: string): Promise<void> {
    await this.connection.db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update').limit(1);
      if (!payment || payment.status === 'SUCCEEDED') {
        throw new PaymentVerificationError();
      }
      if (payment.providerPaymentId && payment.providerPaymentId !== providerPaymentId) {
        // A new Checkout Session can replace only an attempt whose failure was
        // verified. Never replace an active or uncertain provider reference.
        const [previous] = await tx.select({ status: paymentAttempts.status }).from(paymentAttempts)
          .where(and(eq(paymentAttempts.paymentId, paymentId), eq(paymentAttempts.providerAttemptReference, payment.providerPaymentId))).limit(1);
        const [next] = await tx.select({ status: paymentAttempts.status }).from(paymentAttempts)
          .where(and(eq(paymentAttempts.paymentId, paymentId), eq(paymentAttempts.id, attemptId))).limit(1);
        if (previous?.status !== 'FAILED' || next?.status !== 'CREATED') throw new PaymentVerificationError();
      }
      const [order] = await tx.select().from(orders).where(eq(orders.id, payment.orderId)).limit(1);
      await tx.update(payments).set({ status: 'PENDING', providerPaymentId, updatedAt: new Date() }).where(eq(payments.id, paymentId));
      await tx.update(paymentAttempts).set({ status: 'PENDING', providerAttemptReference: providerPaymentId,
        updatedAt: new Date() }).where(and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.paymentId, paymentId)));
      if (order?.visaApplicationId) {
        const [application] = await tx.select({ status: visaApplications.status, customerId: visaApplications.customerId, tripId: visaApplications.tripId })
          .from(visaApplications).where(eq(visaApplications.id, order.visaApplicationId)).for('update').limit(1);
        if (application && ['AWAITING_PAYMENT', 'PAYMENT_FAILED'].includes(application.status)) {
          await tx.update(visaApplications).set({ status: 'PAYMENT_CONFIRMING', updatedAt: new Date() }).where(eq(visaApplications.id, order.visaApplicationId));
          await tx.insert(visaStatusHistory).values({ applicationId: order.visaApplicationId, fromStatus: application.status,
            toStatus: 'PAYMENT_CONFIRMING', actorType: 'SYSTEM', reasonCode: 'PAYMENT_PROVIDER_SESSION_CREATED' });
          await tx.insert(auditEvents).values({ actorCustomerId: application.customerId, tripId: application.tripId,
            visaApplicationId: order.visaApplicationId, event: 'visa.status.changed' });
        }
      }
    });
  }
  async checkoutUnknown(paymentId: string, attemptId: string): Promise<void> {
    await this.connection.db.transaction(async (tx) => {
      const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update').limit(1);
      if (!payment || payment.status === 'SUCCEEDED') return;
      await tx.update(payments).set({ status: 'UNKNOWN', reconciliationState: 'REQUIRED', updatedAt: new Date() })
        .where(eq(payments.id, paymentId));
      await tx.update(paymentAttempts).set({ status: 'UNKNOWN', failureCategory: 'PROVIDER_OUTCOME_UNKNOWN',
        updatedAt: new Date() }).where(and(eq(paymentAttempts.id, attemptId), eq(paymentAttempts.paymentId, paymentId)));
      await tx.insert(commerceAuditEvents).values({ actorType: 'SYSTEM', orderId: payment.orderId,
        paymentId, event: 'payment.outcome_unknown' });
      await tx.insert(commerceOutbox).values({ eventType: 'payment.reconciliation_required', orderId: payment.orderId, paymentId });
    });
  }
  async reconciliationCandidate(paymentId: string): Promise<{ provider: string; providerPaymentId: string | null; status: string } | null> {
    const [row] = await this.connection.db.select({ provider: payments.provider,
      providerPaymentId: payments.providerPaymentId, status: payments.status }).from(payments)
      .where(and(eq(payments.id, paymentId), eq(payments.reconciliationState, 'REQUIRED'))).limit(1);
    return row ?? null;
  }

  async reconciliationCandidateIds(provider: string, limit = 20): Promise<string[]> {
    const rows = await this.connection.db.select({ id: payments.id }).from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.reconciliationState, 'REQUIRED'), isNotNull(payments.providerPaymentId),
        inArray(payments.status, ['PENDING', 'PROCESSING', 'UNKNOWN'])))
      .orderBy(asc(payments.updatedAt)).limit(limit);
    return rows.map((row) => row.id);
  }
  async reconciliationChecked(paymentId: string): Promise<void> {
    await this.connection.db.update(payments).set({ updatedAt: new Date() })
      .where(and(eq(payments.id, paymentId), eq(payments.reconciliationState, 'REQUIRED')));
  }

  async paymentIdByProviderReference(provider: string, providerPaymentId: string): Promise<string | null> {
    const [row] = await this.connection.db.select({ id: payments.id }).from(payments)
      .where(and(eq(payments.provider, provider), eq(payments.providerPaymentId, providerPaymentId))).limit(1);
    return row?.id ?? null;
  }

  /** Called only after a provider adapter has verified the original payload or authenticated status response. */
  async applyVerifiedEvent(provider: string, paymentId: string, event: VerifiedPaymentEvent, requestId: string): Promise<PaymentSummary> {
    if (!event.providerEventId || !event.providerPaymentId || !amountPattern.test(event.amount) ||
        !/^[A-Z]{3}$/.test(event.currency)) throw new PaymentVerificationError();
    await this.connection.db.transaction(async (tx) => {
      // Every payment mutation locks order -> payment, matching reservePayment.
      // Reading the immutable order ID first avoids a retry/webhook deadlock.
      const [reference] = await tx.select({ orderId: payments.orderId }).from(payments).where(eq(payments.id, paymentId)).limit(1);
      if (!reference) throw new PaymentVerificationError();
      const [order] = await tx.select().from(orders).where(eq(orders.id, reference.orderId)).for('update').limit(1);
      const [payment] = await tx.select().from(payments).where(eq(payments.id, paymentId)).for('update').limit(1);
      if (!payment || payment.provider !== provider || payment.providerPaymentId !== event.providerPaymentId ||
          payment.amount !== money(event.amount) || payment.currency !== event.currency) throw new PaymentVerificationError();
      if (!order || order.customerId !== payment.customerId || order.totalAmount !== payment.amount || order.currency !== payment.currency) {
        throw new PaymentVerificationError();
      }
      const [inserted] = await tx.insert(paymentEvents).values({ paymentId, provider, providerEventId: event.providerEventId,
        eventType: event.status, verified: true, processedAt: new Date() })
        .onConflictDoNothing({ target: [paymentEvents.provider, paymentEvents.providerEventId] }).returning({ id: paymentEvents.id });
      if (!inserted) {
        const [prior] = await tx.select({ paymentId: paymentEvents.paymentId, eventType: paymentEvents.eventType })
          .from(paymentEvents).where(and(eq(paymentEvents.provider, provider), eq(paymentEvents.providerEventId, event.providerEventId))).limit(1);
        if (prior?.paymentId !== paymentId || prior.eventType !== event.status) throw new PaymentVerificationError();
        return;
      }
      if (payment.status === 'SUCCEEDED' || order.status === 'PAID') return;
      if (event.status === 'SUCCEEDED') {
        const now = new Date();
        await tx.update(payments).set({ status: 'SUCCEEDED', reconciliationState: 'RESOLVED', paidAt: now, updatedAt: now })
          .where(eq(payments.id, paymentId));
        await tx.update(paymentAttempts).set({ status: 'SUCCEEDED', updatedAt: now })
          .where(and(eq(paymentAttempts.paymentId, paymentId), inArray(paymentAttempts.status, ['CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN'])));
        await tx.update(orders).set({ status: 'PAID', paidAt: now, updatedAt: now,
          fulfillmentStatus: order.status === 'CANCELLED' || order.status === 'EXPIRED' || order.expiresAt && order.expiresAt <= now
            ? 'REVALIDATION_REQUIRED' : 'NOT_STARTED' })
          .where(eq(orders.id, order.id));
        await tx.insert(commerceAuditEvents).values({ actorType: 'PROVIDER', orderId: order.id, paymentId,
          event: 'payment.succeeded', requestId });
        await tx.insert(commerceOutbox).values({ eventType: 'payment.succeeded', orderId: order.id, paymentId });
        if (order.bookingIntentId) {
          // Payment evidence and ticket evidence are separate. Preserve cancelled
          // or uncertain reservation states for staff reconciliation.
          await tx.update(flightBookings).set({ status: order.status === 'CANCELLED' || order.status === 'EXPIRED' || order.expiresAt && order.expiresAt <= now
            ? 'MANUAL_REVIEW_REQUIRED' : 'AWAITING_STAFF_TICKETING', updatedAt: now })
            .where(and(eq(flightBookings.bookingIntentId, order.bookingIntentId), inArray(flightBookings.status, ['PNR_CREATED', 'AWAITING_PAYMENT', 'PAYMENT_PENDING'])));
        }
        if (order.visaApplicationId) {
          const [application] = await tx.select({ status: visaApplications.status, customerId: visaApplications.customerId, tripId: visaApplications.tripId })
            .from(visaApplications).where(eq(visaApplications.id, order.visaApplicationId)).for('update').limit(1);
          if (application && !['CANCELLED', 'REJECTED', 'COMPLETED'].includes(application.status)) {
            await tx.update(visaApplications).set({ status: 'PAID', updatedAt: now }).where(eq(visaApplications.id, order.visaApplicationId));
            await tx.insert(visaStatusHistory).values({ applicationId: order.visaApplicationId, fromStatus: application.status,
              toStatus: 'PAID', actorType: 'PROVIDER', reasonCode: 'PAYMENT_VERIFIED' });
            await tx.insert(auditEvents).values({ actorCustomerId: application.customerId, tripId: application.tripId,
              visaApplicationId: order.visaApplicationId, event: 'visa.payment.confirmed' });
            await tx.insert(auditEvents).values({ actorCustomerId: application.customerId, tripId: application.tripId,
              visaApplicationId: order.visaApplicationId, event: 'visa.status.changed' });
          } else if (application) {
            await tx.insert(auditEvents).values({ actorCustomerId: application.customerId, tripId: application.tripId,
              visaApplicationId: order.visaApplicationId, event: 'visa.payment.reconciliation_required' });
          }
        }
      } else if (event.status === 'FAILED') {
        await tx.update(payments).set({ status: 'FAILED', reconciliationState: 'RESOLVED',
          failedAt: new Date(), updatedAt: new Date() }).where(eq(payments.id, paymentId));
        await tx.update(paymentAttempts).set({ status: 'FAILED', updatedAt: new Date() })
          .where(and(eq(paymentAttempts.paymentId, paymentId), inArray(paymentAttempts.status, ['CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN'])));
        await tx.update(orders).set({ status: 'PAYMENT_FAILED', updatedAt: new Date() }).where(eq(orders.id, order.id));
        await tx.insert(commerceAuditEvents).values({ actorType: 'PROVIDER', orderId: order.id, paymentId,
          event: 'payment.failed', requestId });
        await tx.insert(commerceOutbox).values({ eventType: 'payment.failed', orderId: order.id, paymentId });
        if (order.visaApplicationId) {
          const [application] = await tx.select({ status: visaApplications.status, customerId: visaApplications.customerId, tripId: visaApplications.tripId })
            .from(visaApplications).where(eq(visaApplications.id, order.visaApplicationId)).for('update').limit(1);
          if (application && ['AWAITING_PAYMENT', 'PAYMENT_CONFIRMING', 'PAYMENT_FAILED'].includes(application.status)) {
            await tx.update(visaApplications).set({ status: 'PAYMENT_FAILED', updatedAt: new Date() }).where(eq(visaApplications.id, order.visaApplicationId));
            await tx.insert(visaStatusHistory).values({ applicationId: order.visaApplicationId, fromStatus: application.status,
              toStatus: 'PAYMENT_FAILED', actorType: 'PROVIDER', reasonCode: 'PAYMENT_FAILED' });
            await tx.insert(auditEvents).values({ actorCustomerId: application.customerId, tripId: application.tripId,
              visaApplicationId: order.visaApplicationId, event: 'visa.status.changed' });
          }
        }
      } else if (payment.status === 'CREATED') {
        await tx.update(payments).set({ status: 'PENDING', updatedAt: new Date() }).where(eq(payments.id, paymentId));
      }
    });
    const [updated] = await this.connection.db.select().from(payments).where(eq(payments.id, paymentId)).limit(1);
    if (!updated) throw new PaymentVerificationError();
    return presentPayment(updated);
  }
}
