import { Inject, Injectable } from '@nestjs/common';
import { eq } from 'drizzle-orm';
import { guestFlightCheckoutAttempts, type DatabaseConnection } from '@flyseri/database';
import { ApiException } from '../api-exception.js';
import { DATABASE_CONNECTION } from '../tokens.js';
import { FlightService } from './flight.service.js';

export interface GuestCheckoutAttemptInput {
  searchId: string;
  offerId: string;
  idempotencyKey: string;
  contactName: string;
  contactEmail: string;
  contactPhone: string;
  passengerNames: string[];
}

@Injectable()
export class GuestCheckoutAttemptsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined,
    @Inject(FlightService) private readonly flights: FlightService) {}

  async submit(input: GuestCheckoutAttemptInput, customerId: string | null) {
    if (!this.connection) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Booking activity is unavailable right now.', 503);
    const db = this.connection.db;
    const normalized = {
      contactName: input.contactName.trim(), contactEmail: input.contactEmail.trim().toLowerCase(),
      contactPhone: input.contactPhone.trim(), passengerNames: input.passengerNames.map((name) => name.trim()),
    };
    if (!normalized.contactName || !normalized.passengerNames.length || normalized.passengerNames.some((name) => !name)) {
      throw new ApiException('VALIDATION_ERROR', 'Enter the contact and passenger names before continuing.', 400);
    }
    const sameRequest = (row: typeof guestFlightCheckoutAttempts.$inferSelect) =>
      row.searchId === input.searchId && row.offerId === input.offerId &&
      row.contactName === normalized.contactName && row.contactEmail === normalized.contactEmail &&
      row.contactPhone === normalized.contactPhone && JSON.stringify(row.passengerNames) === JSON.stringify(normalized.passengerNames);
    const [existing] = await db.select().from(guestFlightCheckoutAttempts)
      .where(eq(guestFlightCheckoutAttempts.idempotencyKey, input.idempotencyKey)).limit(1);
    if (existing) {
      if (!sameRequest(existing)) throw new ApiException('CONFLICT', 'This checkout submission key has already been used.', 409);
      return { id: existing.id, status: existing.status, createdAt: existing.createdAt.toISOString() };
    }

    // Resolve the selection server side. Browser prices and itinerary details are never trusted for staff records.
    const selection = await this.flights.selectedOffer(customerId, input.searchId, input.offerId);
    const legs = selection.offer.multiCityLegs ?? [selection.offer.outbound, ...(selection.offer.inbound ? [selection.offer.inbound] : [])];
    const route = legs.map((leg) => `${leg.segments[0]?.origin ?? '—'} → ${leg.segments.at(-1)?.destination ?? '—'}`)
      .join(' · ').slice(0, 320);
    const [created] = await db.insert(guestFlightCheckoutAttempts).values({
      idempotencyKey: input.idempotencyKey, searchId: input.searchId, offerId: input.offerId,
      ...normalized, route, currency: selection.offer.currency,
      shoppingAmount: selection.offer.totalAmount,
    }).onConflictDoNothing({ target: guestFlightCheckoutAttempts.idempotencyKey }).returning();
    const row = created ?? (await db.select().from(guestFlightCheckoutAttempts)
      .where(eq(guestFlightCheckoutAttempts.idempotencyKey, input.idempotencyKey)).limit(1))[0];
    if (!row || !sameRequest(row)) throw new ApiException('CONFLICT', 'This checkout submission key has already been used.', 409);
    return { id: row.id, status: row.status, createdAt: row.createdAt.toISOString() };
  }
}
