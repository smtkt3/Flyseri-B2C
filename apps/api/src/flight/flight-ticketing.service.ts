import { matchesConfirmedItinerary } from './reservation-evidence.js';
import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AppConfig } from '@flyseri/config';
import { auditEvents, flightBookings, flightBookingIntents, orders, payments, type DatabaseConnection } from '@flyseri/database';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG, DATABASE_CONNECTION, SABRE_BOOKING_CLIENT } from '../tokens.js';
import { FlightBookingsService } from './flight-bookings.service.js';
import { SabreBookingManagementClient, type SabreTicketingProfile } from './sabre-booking-management.client.js';
import { cents, confirmedAncillaryItems, type AncillarySnapshot } from './ancillary-purchase.contract.js';

type Profile = SabreTicketingProfile;
const conflict = (message: string) => new ApiException('CONFLICT', message, 409);

@Injectable()
export class FlightTicketingService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined,
    @Inject(SABRE_BOOKING_CLIENT) private readonly sabre: SabreBookingManagementClient | undefined,
    @Inject(FlightBookingsService) private readonly bookings: FlightBookingsService) {}
  private profile(): Profile | null {
    try {
      const input = JSON.parse(this.config.SABRE_TICKETING_PROFILE ?? 'null') as Profile | null;
      if (!input || !/^[A-Z]{2}$/.test(input.ticketCountryCode) || !/^[A-Z0-9]{6}$/.test(input.hardcopyPrinterAddress)) return null;
      if (input.ndcAirlineCodes && (!Array.isArray(input.ndcAirlineCodes) || input.ndcAirlineCodes.length > 100 || input.ndcAirlineCodes.some(code => !/^[A-Z0-9]{2}$/.test(code)))) return null;
      const printers = { ticketCountryCode: input.ticketCountryCode, hardcopyPrinterAddress: input.hardcopyPrinterAddress, ...(input.ndcAirlineCodes ? { ndcAirlineCodes: [...input.ndcAirlineCodes] } : {}) };
      if (input.formOfPayment === 'INVOICE' && typeof input.invoiceDescription === 'string' && input.invoiceDescription.trim() && input.invoiceDescription.length <= 120)
        return { ...printers, formOfPayment: input.formOfPayment, invoiceDescription: input.invoiceDescription };
      if (input.formOfPayment === 'PAYMENTCARD' && /^[A-Z]{2}$/.test(input.cardTypeCode) && /^\d{13,19}$/.test(input.cardNumber) && /^\d{3,4}$/.test(input.cardSecurityCode) &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(input.expiryDate) && input.expiryDate >= new Date().toISOString().slice(0, 7) &&
        (input.manualApprovalCode === undefined || /^[A-Z0-9]{1,12}$/.test(input.manualApprovalCode)))
        {
          if (input.cardHolder && (!input.cardHolder.address || !['givenName', 'surname'].every(key => typeof input.cardHolder![key as 'givenName' | 'surname'] === 'string' && input.cardHolder![key as 'givenName' | 'surname'].trim().length > 0) || !['name', 'street', 'city', 'stateProvince', 'postalCode', 'countryCode'].every(key => typeof input.cardHolder!.address[key as keyof typeof input.cardHolder.address] === 'string' && input.cardHolder!.address[key as keyof typeof input.cardHolder.address].length > 0) || !/^[A-Z]{2}$/.test(input.cardHolder.address.countryCode))) return null;
          if (input.authentications && (!Array.isArray(input.authentications) || input.authentications.length !== 1 || input.authentications[0]?.channelCode !== 'MO')) return null;
          return { ...printers, formOfPayment: input.formOfPayment, cardTypeCode: input.cardTypeCode, cardNumber: input.cardNumber,
          cardSecurityCode: input.cardSecurityCode, expiryDate: input.expiryDate, ...(input.manualApprovalCode ? { manualApprovalCode: input.manualApprovalCode } : {}), ...(input.cardHolder ? { cardHolder: { givenName: input.cardHolder.givenName, surname: input.cardHolder.surname, address: { name: input.cardHolder.address.name, street: input.cardHolder.address.street, city: input.cardHolder.address.city, stateProvince: input.cardHolder.address.stateProvince, postalCode: input.cardHolder.address.postalCode, countryCode: input.cardHolder.address.countryCode } } } : {}), ...(input.authentications ? { authentications: [{ channelCode: 'MO' as const }] } : {}) };
        }
      return null;
    } catch { return null; }
  }
  async capabilities() {
    let evidenceReady = false;
    if (this.config.FLIGHT_TICKETING_EXECUTION_ENABLED === 'true' && this.profile() && this.connection && this.sabre) {
      try {
        const evidence = await this.connection.pool.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'flight_bookings' AND column_name IN ('booked_passenger_names','provider_view_snapshot')");
        const constraint = await this.connection.pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_fulfillment_valid'");
        evidenceReady = evidence.rows[0]?.count === 2 && constraint.rows[0]?.definition?.includes('COMPLETED');
      } catch { /* Keep issuance disabled if evidence storage is unavailable. */ }
    }
    return { ticketIssuanceAvailable: evidenceReady,
    environment: this.config.SABRE_ENV, ticketingMessage: 'CERT ticketing requires a confirmed Stripe sandbox payment and approved Sabre settlement/printer configuration.' }; }
  canFulfillNdc(airlines: string[]) {
    const profile = this.profile();
    return !!profile?.ndcAirlineCodes?.length && airlines.length > 0 && airlines.every(code => profile.ndcAirlineCodes!.includes(code)) &&
      (profile.formOfPayment === 'INVOICE' || !!profile.cardHolder && !!profile.authentications?.length);
  }
  async issue(customerId: string, id: string, confirmedPnr: string) {
    const profile = this.profile();
    if (!(await this.capabilities()).ticketIssuanceAvailable || !profile || !this.connection || !this.sabre) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Test ticket issuance is awaiting Sabre settlement configuration and evidence storage. Your payment and reservation are kept.', 503);
    const booking = await this.bookings.detail(customerId, id);
    if (!booking.pnr || booking.pnr !== confirmedPnr) throw conflict('Confirm this reservation before ticketing.');
    if (booking.selectedOffer.ndcContext && !this.canFulfillNdc(booking.selectedOffer.airlineCodes)) throw conflict('This airline requires an approved NDC settlement profile before ticketing.');
    if (booking.passengerNamesSource !== 'BOOKED_SNAPSHOT') throw conflict('This legacy reservation needs staff passenger reconciliation before ticketing.');
    if (booking.status === 'TICKETED') return booking;
    if (!['AWAITING_STAFF_TICKETING', 'PAID'].includes(booking.status)) throw conflict('This reservation is not ready for ticket issuance.');
    const current = await this.sabre.getBookingView(booking.pnr);
    const [storedIntent] = await this.connection.db.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, booking.bookingIntentId), eq(flightBookingIntents.customerId, customerId))).limit(1);
    const extraSnapshot = storedIntent!.searchRequestSnapshot as AncillarySnapshot;
    const extraPurchase = extraSnapshot.checkoutAncillaryPurchase;
    if (extraSnapshot.checkoutAncillaryRequests?.length && (!extraPurchase || !['CONFIRMED', 'SKIPPED'].includes(extraPurchase.status))) throw conflict('Review airline extras before ticket issuance.');
    const ancillaryIds = extraPurchase?.status === 'CONFIRMED' ? extraPurchase.items.flatMap(item => item.providerAncillaryIds) : [];
    if (extraPurchase?.status === 'CONFIRMED') {
      const evidence = confirmedAncillaryItems(await this.sabre.getPurchaseBooking(booking.pnr), extraPurchase.plans, extraSnapshot.checkoutAncillaryRequests ?? []);
      if (!ancillaryIds.length || new Set(ancillaryIds).size !== ancillaryIds.length || evidence.some(item => !extraPurchase.items.some(expected => expected.requestId === item.requestId && expected.providerAncillaryIds.includes(item.itemId) && expected.airlineCurrency === item.currency && cents(expected.airlineAmount) === cents(item.amount)))) throw conflict('The confirmed airline extra price or association changed. Contact Flyseri before issuance.');
    }
    if (!current.view.cancellationCheckComplete || current.view.tickets.length || current.view.travellers.length !== booking.passengerNames.length || current.view.travellers.some((person,index)=>[person.givenName,person.surname].join(' ').trim().replace(/\s+/g,' ').toUpperCase() !== booking.passengerNames[index]!.trim().replace(/\s+/g,' ').toUpperCase()) || !matchesConfirmedItinerary(current.view, booking.selectedOffer)) throw conflict('The current PNR needs staff review before ticketing.');
    const db = this.connection.db;
    await db.transaction(async tx => {
      const [lockedIntent] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, booking.bookingIntentId), eq(flightBookingIntents.customerId, customerId))).for('update');
      const lockedExtras = (lockedIntent!.searchRequestSnapshot as AncillarySnapshot).checkoutAncillaryPurchase;
      if (JSON.stringify(lockedExtras) !== JSON.stringify(extraPurchase)) throw conflict('The airline extras changed during issuance preparation.');
      const [order] = await tx.select().from(orders).where(and(eq(orders.customerId, customerId), eq(orders.bookingIntentId, booking.bookingIntentId))).for('update').limit(1);
      if (!order || order.status !== 'PAID' || !order.paidAt || order.fulfillmentStatus === 'REVALIDATION_REQUIRED') throw conflict('A confirmed eligible order payment is required before ticketing.');
      if (extraPurchase?.status === 'CONFIRMED' && (order.currency !== extraPurchase.currency || cents(order.totalAmount) !== cents(extraPurchase.totalAmount))) throw conflict('The paid order does not match the confirmed tickets and extras total.');
      const [payment] = await tx.select().from(payments).where(and(eq(payments.orderId, order.id), eq(payments.customerId, customerId))).limit(1);
      if (!payment || payment.status !== 'SUCCEEDED' || payment.provider !== 'STRIPE_TEST' || payment.amount !== order.totalAmount || payment.currency !== order.currency) throw conflict('The sandbox payment evidence does not match the order.');
      const [row] = await tx.select().from(flightBookings).where(and(eq(flightBookings.id, id), eq(flightBookings.customerId, customerId))).for('update').limit(1);
      if (!row || !['AWAITING_STAFF_TICKETING', 'PAID'].includes(row.status) || row.pnrLocator !== confirmedPnr || row.sabreBookingId && row.sabreBookingId !== current.bookingId) throw conflict('This booking changed or already has a ticketing attempt.');
      await tx.update(flightBookings).set({ status: 'TICKETING_IN_PROGRESS', updatedAt: new Date() }).where(eq(flightBookings.id, id));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: booking.tripId, event: 'flight.ticketing.claimed' });
    });
    try {
      await this.sabre.fulfillFlightTickets(confirmedPnr, profile, ancillaryIds, !!booking.selectedOffer.ndcContext);
      const result = await this.sabre.getBookingView(confirmedPnr);
      if (result.bookingId !== current.bookingId || result.view.tickets.length !== booking.passengerNames.length ||
        new Set(result.view.tickets.map(ticket => ticket.number)).size !== result.view.tickets.length ||
        result.view.tickets.some(ticket => !/^\d{13}$/.test(ticket.number) || ticket.status !== 'Issued')) throw new Error('Issued ticket evidence incomplete');
      await db.transaction(async tx => {
        const [intent] = await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id, booking.bookingIntentId)).for('update');
        const [saved] = await tx.update(flightBookings).set({ status: 'TICKETED', lastSabreRefreshAt: new Date(), updatedAt: new Date() })
          .where(and(eq(flightBookings.id, id), eq(flightBookings.status, 'TICKETING_IN_PROGRESS'))).returning({ id: flightBookings.id });
        if (!saved) throw new Error('Ticketing claim changed');
        await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot = ${JSON.stringify(result.view)}::jsonb WHERE id = ${id}::uuid`);
        if (ancillaryIds.length) {
          const snapshot = intent!.searchRequestSnapshot as AncillarySnapshot;
          await tx.update(flightBookingIntents).set({ searchRequestSnapshot: { ...snapshot, checkoutAncillaryPurchase: { ...extraPurchase!, status: 'FULFILLMENT_PENDING', message: 'Flight tickets were verified. Extra-service document issuance was requested and needs document reconciliation before completion.' } }, updatedAt: new Date() }).where(eq(flightBookingIntents.id, booking.bookingIntentId));
        }
        await tx.update(orders).set({ fulfillmentStatus: ancillaryIds.length ? 'NOT_STARTED' : 'COMPLETED', updatedAt: new Date() }).where(and(eq(orders.bookingIntentId, booking.bookingIntentId), eq(orders.customerId, customerId), eq(orders.status, 'PAID')));
        await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: booking.tripId, event: 'flight.ticketing.verified' });
      });
    } catch {
      // Every result after sending is potentially a successful airline mutation.
      // A failure must never enable an automatic second issuance attempt.
      await db.update(flightBookings).set({ status: 'MANUAL_REVIEW_REQUIRED', updatedAt: new Date() })
        .where(and(eq(flightBookings.id, id), eq(flightBookings.status, 'TICKETING_IN_PROGRESS')));
      throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Ticket issuance needs reconciliation with Sabre. Do not retry or make another payment; contact Flyseri.', 503);
    }
    return this.bookings.detail(customerId, id);
  }
}
