import { and, eq, sql } from 'drizzle-orm';
import { auditEvents, flightBookingIntents, flightBookings, type DatabaseConnection } from '@flyseri/database';
import type { BookingRejectionDiagnostic, SabreBookingUnknownError } from './sabre-booking-management.client.js';

export class BookingReservationConflictError extends Error {}
export class BookingReservationMissingError extends Error {}

/** The database claim is the authoritative duplicate guard before any provider call. */
export class BookingReservationRepository {
  constructor(private readonly connection: DatabaseConnection) {}

  async claim(customerId: string, intentId: string, expectedFare?: { currency: string; amount: string }, passengerNames?: string[]): Promise<string> {
    return this.connection.db.transaction(async (tx) => {
      const [intent] = await tx.select().from(flightBookingIntents)
        .where(and(eq(flightBookingIntents.id, intentId), eq(flightBookingIntents.customerId, customerId)))
        .limit(1).for('update');
      if (!intent) throw new BookingReservationMissingError();
      if (expectedFare) {
        const minor = (amount: string) => { const [whole, fraction = ''] = amount.split('.'); return BigInt(whole!) * 100n + BigInt((fraction + '00').slice(0, 2)); };
        if (!intent.validatedTotalAmount || intent.currency !== expectedFare.currency || minor(intent.validatedTotalAmount) !== minor(expectedFare.amount)) throw new BookingReservationConflictError('The validated fare changed during booking preparation');
      }
      if (intent.status !== 'READY_FOR_PAYMENT' || !intent.validatedTotalAmount ||
        !intent.expiresAt || intent.expiresAt.getTime() <= Date.now()) throw new BookingReservationConflictError('The fare must be validated again');
      const [existing] = await tx.select({ id: flightBookings.id }).from(flightBookings)
        .where(eq(flightBookings.bookingIntentId, intentId)).limit(1);
      if (existing) throw new BookingReservationConflictError('This selection already has a booking attempt');
      const [created] = await tx.insert(flightBookings).values({
        customerId, bookingIntentId: intentId, tripId: intent.tripId, status: 'BOOKING_IN_PROGRESS',
      }).onConflictDoNothing({ target: flightBookings.bookingIntentId }).returning({ id: flightBookings.id });
      if (!created) throw new BookingReservationConflictError('This selection already has a booking attempt');
      const evidence = await tx.execute(sql`SELECT EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'flight_bookings' AND column_name = 'booked_passenger_names') AS ready`);
      if (passengerNames && evidence.rows[0]?.ready === true) await tx.execute(sql`UPDATE flight_bookings SET booked_passenger_names = ${JSON.stringify(passengerNames)}::jsonb WHERE id = ${created.id}::uuid`);
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: intent.tripId, event: 'flight.booking.claimed' });
      return created.id;
    });
  }

  async created(id: string, confirmationId: string, sabreBookingId: string): Promise<void> {
    if (!/^[A-Z0-9]{5,16}$/i.test(confirmationId) || !sabreBookingId.trim()) throw new Error('Invalid Sabre booking identifiers');
    const [row] = await this.connection.db.update(flightBookings).set({ status: 'PNR_CREATED',
      pnrLocator: confirmationId.toUpperCase(), sabreBookingId, updatedAt: new Date() })
      .where(and(eq(flightBookings.id, id), eq(flightBookings.status, 'BOOKING_IN_PROGRESS')))
      .returning({ id: flightBookings.id });
    if (!row) throw new BookingReservationConflictError('Booking result cannot be applied to this state');
  }

  async unknown(id: string, error?: SabreBookingUnknownError): Promise<void> {
    await this.connection.db.transaction(async tx => {
    const [row] = await tx.update(flightBookings).set({ status: 'BOOKING_UNKNOWN', updatedAt: new Date() })
      .where(and(eq(flightBookings.id, id), eq(flightBookings.status, 'BOOKING_IN_PROGRESS')))
      .returning({ id: flightBookings.id, customerId:flightBookings.customerId, tripId:flightBookings.tripId });
    if (!row) throw new BookingReservationConflictError('Booking result cannot be applied to this state');
    if (error) await tx.insert(auditEvents).values({actorCustomerId:row.customerId,tripId:row.tripId,event:`flight.booking.unknown-diagnostic:${id}:${JSON.stringify({reason:error.reason,httpStatus:error.httpStatus,...error.diagnostic})}`});
    });
  }

  async rejected(id: string, failureCode?: 'AGENCY_CONFIGURATION' | 'PROVIDER_REJECTED', diagnostic?: {httpStatus?: number; errors: BookingRejectionDiagnostic[]}): Promise<void> {
    await this.connection.db.transaction(async tx => {
    const [row] = await tx.update(flightBookings).set({ status: 'BOOKING_FAILED', updatedAt: new Date() })
      .where(and(eq(flightBookings.id, id), eq(flightBookings.status, 'BOOKING_IN_PROGRESS')))
      .returning({ id: flightBookings.id, customerId: flightBookings.customerId, tripId: flightBookings.tripId });
    if (!row) throw new BookingReservationConflictError('Booking result cannot be applied to this state');
    if (failureCode) await tx.insert(auditEvents).values({actorCustomerId:row.customerId,tripId:row.tripId,event:`flight.booking.rejected:${id}:${failureCode}`});
    if (diagnostic) await tx.insert(auditEvents).values({actorCustomerId:row.customerId,tripId:row.tripId,event:`flight.booking.rejection-diagnostic:${id}:${JSON.stringify(diagnostic)}`});
    });
  }
}
