import { randomUUID } from 'node:crypto';
import { Inject, Injectable, Logger, type OnModuleDestroy, type OnModuleInit } from '@nestjs/common';
import type { DatabaseConnection } from '@flyseri/database';
import type { FareWatch, FlightSearchRequest, SupportStage, TravelSupportRequest } from '@flyseri/types';
import { DATABASE_CONNECTION } from '../tokens.js';
import { ApiException } from '../api-exception.js';
import { FlightService } from '../flight/flight.service.js';
import { normalizeFlightSearch } from '../flight/flight-search.js';
import type { AdminIdentity } from '../admin/admin-auth.js';

const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'Travel assistance is temporarily unavailable.', 503);
const conflict = (message: string) => new ApiException('CONFLICT', message, 409);
export const supportTransitions: Record<SupportStage, SupportStage[]> = {
  QUEUED: ['REVIEWING', 'CANCELLED'], REVIEWING: ['QUOTE_READY', 'IN_PROGRESS', 'CANCELLED'],
  QUOTE_READY: ['REVIEWING', 'CANCELLED'], APPROVED: ['IN_PROGRESS', 'CANCELLED'],
  IN_PROGRESS: ['COMPLETED', 'CANCELLED'], COMPLETED: [], CANCELLED: [],
};
export function matchingFare(offers: { currency: string; totalAmount: string }[], currency: string): number | null {
  const amounts = offers.filter(offer => offer.currency === currency).map(offer => Number(offer.totalAmount)).filter(value => Number.isFinite(value) && value > 0);
  return amounts.length ? Math.min(...amounts) : null;
}
type WatchRow = { id: string; customer_id: string; search: FlightSearchRequest; target_amount: string; currency: string; active: boolean; last_amount: string | null; checked_at: Date | null; matched_at: Date | null; check_error: boolean };
const presentWatch = (row: WatchRow): FareWatch => ({ id: row.id, search: row.search, targetAmount: Number(row.target_amount), currency: row.currency, active: row.active,
  lastAmount: row.last_amount === null ? null : Number(row.last_amount), checkedAt: row.checked_at?.toISOString() ?? null,
  matchedAt: row.matched_at?.toISOString() ?? null, checkError: row.check_error });
type SupportRow = { id: string; version: number; conversation_id: string; reason: string; stage: SupportStage; quote: TravelSupportRequest['quote']; updates: TravelSupportRequest['updates']; created_at: Date; updated_at: Date };
const presentSupport = (row: SupportRow): TravelSupportRequest => ({ id: row.id, version: row.version, conversationId: row.conversation_id, reason: row.reason, stage: row.stage, quote: row.quote, updates: row.updates, createdAt: row.created_at.toISOString(), updatedAt: row.updated_at.toISOString() });

@Injectable()
export class TravelService implements OnModuleInit, OnModuleDestroy {
  private timer?: ReturnType<typeof setInterval>;
  private running = false;
  private stopped = false;
  private readonly logger = new Logger(TravelService.name);
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined, @Inject(FlightService) private readonly flights: FlightService) {}
  private get pool() { if (!this.connection) throw unavailable(); return this.connection.pool; }
  onModuleInit() {
    if (!this.connection) return;
    this.timer = setInterval(() => { void this.checkDue().catch(() => this.logger.warn('Fare watch scan unavailable')); }, 60_000);
    this.timer.unref();
  }
  onModuleDestroy() { this.stopped = true; if (this.timer) clearInterval(this.timer); }
  async watches(customerId: string) {
    return (await this.pool.query<WatchRow>('SELECT * FROM fare_watches WHERE customer_id=$1 ORDER BY created_at DESC LIMIT 20', [customerId])).rows.map(presentWatch);
  }
  async watch(customerId: string, input: { search: FlightSearchRequest; targetAmount: number }) {
    const search = normalizeFlightSearch(input.search);
    if (search.children || search.infants) throw conflict('Price watches currently support adult fares.');
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      // Serialize the cap and duplicate check across tabs and server processes.
      await client.query('SELECT id FROM customers WHERE id=$1 FOR UPDATE', [customerId]);
      const found = await client.query<WatchRow>('SELECT * FROM fare_watches WHERE customer_id=$1 AND search=$2::jsonb AND active=true LIMIT 1', [customerId, JSON.stringify(search)]);
      const count = await client.query<{ count: string }>('SELECT count(*) FROM fare_watches WHERE customer_id=$1', [customerId]);
      if (!found.rows.length && Number(count.rows[0]!.count) >= 20) throw conflict('Remove an older price watch before adding another.');
      const rows = found.rows.length
        ? await client.query<WatchRow>('UPDATE fare_watches SET target_amount=$3, matched_at=NULL, checked_at=NULL WHERE id=$1 AND customer_id=$2 RETURNING *', [found.rows[0]!.id, customerId, input.targetAmount])
        : await client.query<WatchRow>('INSERT INTO fare_watches(customer_id,search,target_amount,currency) VALUES($1,$2,$3,$4) RETURNING *', [customerId, JSON.stringify(search), input.targetAmount, search.currency]);
      await client.query('COMMIT');
      return presentWatch(rows.rows[0]!);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
  async removeWatch(customerId: string, id: string) {
    const result = await this.pool.query('DELETE FROM fare_watches WHERE id=$1 AND customer_id=$2 RETURNING id', [id, customerId]);
    if (!result.rows.length) throw new ApiException('NOT_FOUND', 'Price watch not found.', 404);
    return { removed: true };
  }
  async checkDue() {
    if (this.running || this.stopped || !this.connection) return;
    this.running = true;
    try {
      // Claim a small persistent batch. Multiple API instances cannot claim the same watch.
      const rows = await this.pool.query<WatchRow>(`UPDATE fare_watches SET checked_at=now() WHERE id IN (
        SELECT id FROM fare_watches WHERE active AND (checked_at IS NULL OR checked_at < now()-interval '6 hours')
        ORDER BY checked_at NULLS FIRST LIMIT 3 FOR UPDATE SKIP LOCKED) RETURNING *`);
      for (const row of rows.rows) {
        if (this.stopped) break;
        if (row.search.departureDate < new Date().toISOString().slice(0, 10)) {
          await this.pool.query('UPDATE fare_watches SET active=false WHERE id=$1', [row.id]); continue;
        }
        try {
          const result = await this.flights.search(row.customer_id, randomUUID(), row.search);
          const amount = matchingFare(result.offers, row.currency);
          await this.pool.query(`UPDATE fare_watches SET last_amount=$2,check_error=false,
            matched_at=CASE WHEN $2::numeric <= target_amount THEN coalesce(matched_at,now()) ELSE NULL END WHERE id=$1`, [row.id, amount]);
        } catch {
          await this.pool.query('UPDATE fare_watches SET check_error=true WHERE id=$1', [row.id]);
        }
      }
    } finally { this.running = false; }
  }
  async requests(customerId?: string) {
    return (await this.pool.query<SupportRow>(`SELECT * FROM travel_support_requests ${customerId ? 'WHERE customer_id=$1' : ''} ORDER BY updated_at DESC LIMIT 100`, customerId ? [customerId] : [])).rows.map(presentSupport);
  }
  async supportDetail(id: string) {
    const row = (await this.pool.query<SupportRow & { customer_id: string }>('SELECT * FROM travel_support_requests WHERE id=$1', [id])).rows[0];
    if (!row) throw new ApiException('NOT_FOUND', 'Support request not found.', 404);
    // A confirmed handover is the access boundary. Do not expose document/tool payloads.
    const messages = (await this.pool.query('SELECT role,content,created_at AS "createdAt" FROM (SELECT role,content,created_at FROM ai_messages WHERE conversation_id=$1 AND created_at <= $2 ORDER BY created_at DESC LIMIT 100) shared ORDER BY created_at ASC', [row.conversation_id, row.created_at])).rows;
    const customer = (await this.pool.query('SELECT id,display_name AS "displayName",phone_country_code AS "phoneCountryCode",phone_number AS "phoneNumber" FROM customers WHERE id=$1', [row.customer_id])).rows[0];
    return { request: presentSupport(row), customer, messages };
  }
  async approve(customerId: string, id: string, expectedVersion: number) {
    const result = await this.pool.query<SupportRow>(`UPDATE travel_support_requests SET stage='APPROVED',updated_at=now(),version=version+1,updates=updates || $4::jsonb
      WHERE id=$1 AND customer_id=$2 AND stage='QUOTE_READY' AND version=$3 AND (quote->>'expiresAt')::timestamptz > now() RETURNING *`,
    [id, customerId, expectedVersion, JSON.stringify([{ stage: 'APPROVED', message: 'Customer approved the quoted service and fee. Payment and airline processing still require confirmation.', at: new Date().toISOString(), author: 'CUSTOMER' }])]);
    if (!result.rows.length) throw conflict('This quote changed or expired. Refresh before approving.');
    return presentSupport(result.rows[0]!);
  }
  async updateRequest(id: string, input: { stage: SupportStage; message: string; expectedVersion: number; quote?: NonNullable<TravelSupportRequest['quote']> }, staff: AdminIdentity, requestId: string) {
    const client = await this.pool.connect();
    try {
      await client.query('BEGIN');
      const row = (await client.query<SupportRow>('SELECT * FROM travel_support_requests WHERE id=$1 FOR UPDATE', [id])).rows[0];
      if (!row) throw new ApiException('NOT_FOUND', 'Support request not found.', 404);
      if (row.version !== input.expectedVersion || !supportTransitions[row.stage].includes(input.stage)) throw conflict('Refresh this request before updating its progress.');
      if (input.stage === 'QUOTE_READY' && (!input.quote || Date.parse(input.quote.expiresAt) <= Date.now())) throw conflict('Provide a valid, unexpired fee quote.');
      const update = { stage: input.stage, message: input.message.trim(), at: new Date().toISOString(), author: 'TEAM' };
      const quote = input.stage === 'QUOTE_READY' ? input.quote : input.stage === 'REVIEWING' ? null : row.quote;
      const result = await client.query<SupportRow>('UPDATE travel_support_requests SET stage=$2,quote=$3,updates=updates || $4::jsonb,updated_at=now(),version=version+1 WHERE id=$1 RETURNING *', [id, input.stage, JSON.stringify(quote), JSON.stringify([update])]);
      await client.query(`INSERT INTO admin_audit_events(staff_user_id,staff_role,event,resource_type,resource_id,request_id) VALUES($1,$2,'support.progress.updated','support_request',$3,$4)`, [staff.staffUserId, staff.role, id, requestId]);
      await client.query('COMMIT'); return presentSupport(result.rows[0]!);
    } catch (error) { await client.query('ROLLBACK'); throw error; } finally { client.release(); }
  }
}
