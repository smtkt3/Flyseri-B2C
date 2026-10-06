import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, or, sql, type SQL } from 'drizzle-orm';
import { adminAuditEvents, customers, flightBookingIntents, flightBookings, guestFlightCheckoutAttempts, orders, payments, type DatabaseConnection } from '@flyseri/database';
import type { FlightOffer } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { DATABASE_CONNECTION, FLIGHT_TELEMETRY, SABRE_BOOKING_CLIENT } from '../tokens.js';
import type { FlightTelemetry } from '../flight/flight.telemetry.js';
import type { SabreBookingManagementClient } from '../flight/sabre-booking-management.client.js';
import type { AdminListQuery } from './admin-records.service.js';
import type { AdminIdentity } from './admin-auth.js';

const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'Flyseri booking records are unavailable.', 503);
const routeOf = (snapshot: unknown): string | null => {
  const offer = snapshot as Partial<FlightOffer> | null;
  const first = offer?.outbound?.segments?.[0];
  const legs = offer?.multiCityLegs ?? [offer?.outbound, offer?.inbound].filter(Boolean);
  const lastLeg = legs.at(-1);
  const last = lastLeg?.segments?.at(-1);
  return first?.origin && last?.destination ? `${first.origin} → ${last.destination}` : null;
};
const actionRequired = (status: string): string | null => {
  if (['BOOKING_UNKNOWN', 'MANUAL_REVIEW_REQUIRED'].includes(status)) return 'Reconcile with Sabre before another Create Booking attempt';
  if (['AWAITING_STAFF_TICKETING', 'TICKETING_FAILED'].includes(status)) return 'Staff ticketing review';
  if (['BOOKING_FAILED', 'FARE_CHANGED', 'PNR_EXPIRED', 'REFUND_REQUIRED'].includes(status)) return 'Manual booking review';
  return null;
};

@Injectable()
export class AdminFlightsService {
  constructor(@Inject(FLIGHT_TELEMETRY) private readonly telemetry: FlightTelemetry,
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined,
    @Inject(SABRE_BOOKING_CLIENT) private readonly sabre: SabreBookingManagementClient | undefined) {}
  private get db() { if (!this.connection) throw unavailable(); return this.connection.db; }
  summary() {
    const counters = this.telemetry.snapshot();
    const hits = counters.bfm_cache_hit_total ?? 0;
    const misses = counters.bfm_cache_miss_total ?? 0;
    return { window: 'current_api_process', startedAt: this.telemetry.startedAt,
      customerSearches: counters.customer_flight_search_total ?? 0,
      sabreCalls: counters.bfm_sabre_call_total ?? 0,
      sabreErrors: counters.bfm_sabre_error_total ?? 0,
      cacheHits: hits, cacheMisses: misses,
      cacheHitRatePercent: hits + misses ? Math.round(1000 * hits / (hits + misses)) / 10 : null,
      coalescedSearches: counters.bfm_coalesced_request_total ?? 0,
      rateLimitedSearches: counters.rate_limited_search_total ?? 0,
      activityHistoryAvailable: false };
  }

  async checkoutAttempts(query: AdminListQuery) {
    const filters: SQL[] = [];
    if (query.status) filters.push(eq(guestFlightCheckoutAttempts.status, query.status));
    if (query.search) filters.push(or(ilike(guestFlightCheckoutAttempts.contactName, `%${query.search}%`),
      ilike(guestFlightCheckoutAttempts.contactEmail, `%${query.search}%`))!);
    const where = filters.length ? and(...filters) : undefined;
    const [rows, total] = await Promise.all([
      this.db.select().from(guestFlightCheckoutAttempts).where(where)
        .orderBy(desc(guestFlightCheckoutAttempts.createdAt), desc(guestFlightCheckoutAttempts.id))
        .limit(query.limit).offset((query.page - 1) * query.limit),
      this.db.select({ count: count() }).from(guestFlightCheckoutAttempts).where(where),
    ]);
    return { items: rows.map((row) => ({ id: row.id, contactName: row.contactName, contactEmail: row.contactEmail,
      contactPhone: row.contactPhone, passengerNames: row.passengerNames, route: row.route,
      amount: row.shoppingAmount, amountKind: 'SHOPPING', currency: row.currency, status: row.status,
      pnr: null, paymentStatus: 'NOT_STARTED', ticketStatus: 'NOT_VERIFIED',
      createdAt: row.createdAt.toISOString() })), total: total[0]?.count ?? 0, page: query.page, limit: query.limit };
  }

  async checkoutAttempt(id: string) {
    const [row] = await this.db.select().from(guestFlightCheckoutAttempts)
      .where(eq(guestFlightCheckoutAttempts.id, id)).limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Checkout attempt not found.', 404);
    return { id: row.id, contactName: row.contactName, contactEmail: row.contactEmail,
      contactPhone: row.contactPhone, passengerNames: row.passengerNames, route: row.route,
      amount: row.shoppingAmount, amountKind: 'SHOPPING', currency: row.currency, status: row.status,
      pnr: null, paymentStatus: 'NOT_STARTED', ticketStatus: 'NOT_VERIFIED', createdAt: row.createdAt.toISOString() };
  }

  async bookings(query: AdminListQuery) {
    const filters: SQL[] = [];
    if (query.customerId) filters.push(eq(flightBookings.customerId, query.customerId));
    if (query.tripId) filters.push(eq(flightBookings.tripId, query.tripId));
    if (query.status) filters.push(eq(flightBookings.status, query.status));
    if (query.search) filters.push(or(ilike(flightBookings.pnrLocator, `%${query.search}%`), ilike(customers.displayName, `%${query.search}%`))!);
    const where = filters.length ? and(...filters) : undefined;
    const [rows, total] = await Promise.all([
      this.db.select({ booking: flightBookings, customerName: customers.displayName,
        offer: flightBookingIntents.selectedOfferSnapshot, currency: flightBookingIntents.currency,
        amount: flightBookingIntents.validatedTotalAmount, shoppingAmount: flightBookingIntents.searchTotalAmount,
        orderId: orders.id, orderStatus: orders.status, paymentStatus: payments.status, paidAt: payments.paidAt })
        .from(flightBookings).innerJoin(customers, eq(flightBookings.customerId, customers.id))
        .innerJoin(flightBookingIntents, eq(flightBookings.bookingIntentId, flightBookingIntents.id))
        .leftJoin(orders, eq(orders.bookingIntentId, flightBookings.bookingIntentId))
        .leftJoin(payments, eq(payments.orderId, orders.id)).where(where)
        .orderBy(desc(flightBookings.createdAt), desc(flightBookings.id)).limit(query.limit).offset((query.page - 1) * query.limit),
      this.db.select({ count: count() }).from(flightBookings).innerJoin(customers, eq(flightBookings.customerId, customers.id)).where(where),
    ]);
    return { items: rows.map(({ booking, customerName, offer, currency, amount, shoppingAmount, orderId, orderStatus, paymentStatus, paidAt }) => ({
      id: booking.id, bookingIntentId: booking.bookingIntentId, orderId, customerId: booking.customerId, customerName,
      tripId: booking.tripId, route: routeOf(offer), pnr: booking.pnrLocator, status: booking.status,
      amount: amount ?? shoppingAmount, amountKind: amount ? 'VALIDATED' : 'SHOPPING', currency,
      orderStatus: orderStatus ?? 'NOT_STARTED', paymentStatus: paymentStatus ?? 'NOT_STARTED',
      paidAt: paymentStatus === 'SUCCEEDED' ? paidAt?.toISOString() ?? null : null,
      ticketStatus: booking.status === 'TICKETED' ? 'TICKETED' : 'NOT_VERIFIED',
      createdAt: booking.createdAt.toISOString(), lastSabreRefreshAt: booking.lastSabreRefreshAt?.toISOString() ?? null,
      actionRequired: actionRequired(booking.status),
    })), total: total[0]?.count ?? 0, page: query.page, limit: query.limit };
  }

  async booking(id: string) {
    // A direct, permission-guarded lookup keeps the detail endpoint independent of queue pagination.
    const [row] = await this.db.select({ booking: flightBookings, customerName: customers.displayName,
      offer: flightBookingIntents.selectedOfferSnapshot, currency: flightBookingIntents.currency, checkoutSnapshot: flightBookingIntents.searchRequestSnapshot,
      serviceRequests: flightBookingIntents.serviceRequests,
      amount: flightBookingIntents.validatedTotalAmount, shoppingAmount: flightBookingIntents.searchTotalAmount,
      orderId: orders.id, orderStatus: orders.status, paymentStatus: payments.status, paidAt: payments.paidAt })
      .from(flightBookings).innerJoin(customers, eq(flightBookings.customerId, customers.id))
      .innerJoin(flightBookingIntents, eq(flightBookings.bookingIntentId, flightBookingIntents.id))
      .leftJoin(orders, eq(orders.bookingIntentId, flightBookings.bookingIntentId))
      .leftJoin(payments, eq(payments.orderId, orders.id)).where(eq(flightBookings.id, id)).limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Booking not found.', 404);
    const { booking, customerName, offer, currency, amount, shoppingAmount, orderId, orderStatus, paymentStatus, paidAt } = row;
    return { id: booking.id, bookingIntentId: booking.bookingIntentId, orderId, customerId: booking.customerId, customerName,
      serviceRequests: Array.isArray(row.serviceRequests) && row.serviceRequests.length ? row.serviceRequests
        : (row.checkoutSnapshot as { checkoutServiceRequests?: unknown[] }).checkoutServiceRequests ?? [],
      tripId: booking.tripId, route: routeOf(offer), pnr: booking.pnrLocator, sabreBookingId: booking.sabreBookingId,
      status: booking.status, amount: amount ?? shoppingAmount, amountKind: amount ? 'VALIDATED' : 'SHOPPING', currency,
      orderStatus: orderStatus ?? 'NOT_STARTED', paymentStatus: paymentStatus ?? 'NOT_STARTED',
      paidAt: paymentStatus === 'SUCCEEDED' ? paidAt?.toISOString() ?? null : null,
      ticketStatus: booking.status === 'TICKETED' ? 'TICKETED' : 'NOT_VERIFIED',
      createdAt: booking.createdAt.toISOString(), updatedAt: booking.updatedAt.toISOString(),
      lastSabreRefreshAt: booking.lastSabreRefreshAt?.toISOString() ?? null, actionRequired: actionRequired(booking.status) };
  }

  async refresh(id: string, staff: AdminIdentity, requestId: string) {
    if (!this.sabre) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Sabre booking lookup is unavailable.', 503);
    const [booking] = await this.db.select().from(flightBookings).where(eq(flightBookings.id, id)).limit(1);
    if (!booking) throw new ApiException('NOT_FOUND', 'Booking not found.', 404);
    if (!booking.pnrLocator) throw new ApiException('CONFLICT', 'This attempt has no PNR. It needs manual reconciliation.', 409);
    this.telemetry.increment('booking_get_total');
    let sabreResult: Awaited<ReturnType<SabreBookingManagementClient['getBookingView']>>;
    try { sabreResult = await this.sabre.getBookingView(booking.pnrLocator); }
    catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Sabre could not verify this booking right now.', 503); }
    if (booking.sabreBookingId && booking.sabreBookingId !== sabreResult.bookingId) {
      throw new ApiException('CONFLICT', 'Sabre returned a different booking identifier. Review this reservation manually.', 409);
    }
    await this.db.transaction(async (tx) => {
      const [updated] = await tx.update(flightBookings).set({ sabreBookingId: sabreResult.bookingId,
        lastSabreRefreshAt: new Date(), updatedAt: new Date() })
        .where(and(eq(flightBookings.id, id), eq(flightBookings.pnrLocator, booking.pnrLocator!)))
        .returning({ id: flightBookings.id });
      if (!updated) throw new ApiException('CONFLICT', 'This booking changed during the Sabre refresh.', 409);
      const evidence = await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'flight_bookings' AND column_name = 'provider_view_snapshot') AS ready`);
      if (evidence.rows[0]?.ready === true) await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot = ${JSON.stringify(sabreResult.view)}::jsonb WHERE id = ${id}::uuid`);
      await tx.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role,
        event: 'flight.booking.refreshed', resourceType: 'flight_booking', resourceId: id, requestId });
    });
    // Refresh returns evidence for staff review without changing fulfillment status.
    return { ...await this.booking(id), providerView: sabreResult.view };
  }
}
