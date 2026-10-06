import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import { and, eq, inArray } from 'drizzle-orm';
import { auditEvents, flightBookings, orders, payments, type DatabaseConnection } from '@flyseri/database';
import { DATABASE_CONNECTION } from '../tokens.js';
import { FlightTicketingService } from './flight-ticketing.service.js';

/** Persistent paid bookings are the queue; a browser return is never payment evidence. */
@Injectable()
export class FlightFulfillmentPoller implements OnModuleInit, OnModuleDestroy {
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopped = false;
  private readonly logger = new Logger(FlightFulfillmentPoller.name);
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined,
    @Inject(FlightTicketingService) private readonly ticketing: FlightTicketingService) {}
  onModuleInit() {
    if (!this.connection) return;
    this.timer = setInterval(() => { void this.runOnce().catch(() => this.logger.warn('Paid-flight fulfillment scan unavailable')); }, 15_000);
    this.timer.unref();
  }
  onModuleDestroy() { this.stopped = true; if (this.timer) clearInterval(this.timer); }
  async runOnce() {
    if (this.running || this.stopped || !this.connection) return;
    this.running = true;
    try {
      if (!(await this.ticketing.capabilities()).ticketIssuanceAvailable) return;
      const db = this.connection.db;
      const candidates = await db.selectDistinct({id:flightBookings.id,customerId:flightBookings.customerId,pnr:flightBookings.pnrLocator,tripId:flightBookings.tripId})
        .from(flightBookings).innerJoin(orders,and(eq(orders.bookingIntentId,flightBookings.bookingIntentId),eq(orders.customerId,flightBookings.customerId)))
        .innerJoin(payments,and(eq(payments.orderId,orders.id),eq(payments.customerId,orders.customerId)))
        .where(and(inArray(flightBookings.status,['AWAITING_STAFF_TICKETING','PAID']),eq(orders.status,'PAID'),eq(orders.fulfillmentStatus,'NOT_STARTED'),eq(payments.status,'SUCCEEDED'),eq(payments.provider,'STRIPE_TEST'))).limit(10);
      for (const booking of candidates) {
        if (this.stopped) break;
        if (!booking.pnr) continue;
        try {
          // issue() verifies amount, currency, passengers, segments and extras,
          // then atomically claims TICKETING_IN_PROGRESS before calling Sabre.
          await this.ticketing.issue(booking.customerId,booking.id,booking.pnr);
        } catch {
          // Never blindly retry an airline operation. Persist the review state
          // even for preflight failures so another process cannot retry it.
          await db.transaction(async tx=>{
            const changed=await tx.update(flightBookings).set({status:'MANUAL_REVIEW_REQUIRED',updatedAt:new Date()})
              .where(and(eq(flightBookings.id,booking.id),inArray(flightBookings.status,['AWAITING_STAFF_TICKETING','PAID']))).returning({id:flightBookings.id});
            if (changed.length) await tx.insert(auditEvents).values({actorCustomerId:booking.customerId,tripId:booking.tripId,event:'flight.automatic-ticketing.review-required'});
          });
        }
      }
    } finally { this.running = false; }
  }
}
