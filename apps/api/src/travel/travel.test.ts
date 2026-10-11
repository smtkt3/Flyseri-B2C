import 'reflect-metadata';
import { randomUUID } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { PGlite } from '@electric-sql/pglite';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { DatabaseConnection } from '@flyseri/database';
import type { FlightSearchRequest, TravelSupportRequest } from '@flyseri/types';
import type { FlightService } from '../flight/flight.service.js';
import { budgetIntent } from './budget-intent.js';
import { matchingFare, TravelService } from './travel.service.js';

describe('travel assistance storage and ownership', () => {
  let db: PGlite;
  let service: TravelService;
  const customer = randomUUID(), other = randomUUID(), conversation = randomUUID(), action = randomUUID();
  const search: FlightSearchRequest = { origin: 'DAC', destination: 'KUL', departureDate: '2027-02-10', adults: 2, children: 0, infants: 0, tripType: 'ONE_WAY', cabin: 'ECONOMY', currency: 'BDT' };
  const flights = { search: vi.fn() };
  const staff = { staffUserId: randomUUID(), role: 'support_staff' as const };
  beforeEach(async () => {
    db = new PGlite();
    await db.exec('CREATE TABLE customers(id uuid PRIMARY KEY,display_name text,phone_country_code text,phone_number text); CREATE TABLE ai_conversations(id uuid PRIMARY KEY); CREATE TABLE ai_pending_actions(id uuid PRIMARY KEY); CREATE TABLE ai_messages(conversation_id uuid,role text,content text,payload jsonb,created_at timestamptz DEFAULT now()); CREATE TABLE admin_audit_events(staff_user_id uuid,staff_role text,event text,resource_type text,resource_id uuid,request_id text);');
    await db.exec(readFileSync(new URL('../../../../packages/database/drizzle/0029_travel_assistance.sql', import.meta.url), 'utf8').replaceAll('--> statement-breakpoint', ''));
    await db.query('INSERT INTO customers(id) VALUES($1),($2)', [customer, other]);
    await db.query('INSERT INTO ai_conversations(id) VALUES($1)', [conversation]);
    await db.query('INSERT INTO ai_pending_actions(id) VALUES($1)', [action]);
    const pool = { query: (sql: string, params?: unknown[]) => db.query(sql, params), connect: async () => ({ query: (sql: string, params?: unknown[]) => db.query(sql, params), release() {} }) };
    flights.search.mockReset();
    service = new TravelService({ pool } as unknown as DatabaseConnection, flights as unknown as FlightService);
  }, 30000);
  afterEach(async () => { service?.onModuleDestroy(); await db?.close(); });
  it('deduplicates watches and isolates customer reads and deletion', async () => {
    const first = await service.watch(customer, { search, targetAmount: 50000 });
    const second = await service.watch(customer, { search, targetAmount: 45000 });
    expect(second.id).toBe(first.id); expect(second.targetAmount).toBe(45000);
    expect(await service.watches(other)).toEqual([]);
    await expect(service.removeWatch(other, first.id)).rejects.toMatchObject({ status: 404 });
    await service.removeWatch(customer, first.id); expect(await service.watches(customer)).toEqual([]);
  });
  it('records matching fares only in the requested currency and does not repeat a fresh check', async () => {
    await service.watch(customer, { search, targetAmount: 50000 });
    flights.search.mockResolvedValue({ offers: [{ currency: 'USD', totalAmount: '1' }, { currency: 'BDT', totalAmount: '40000' }] });
    await service.checkDue(); await service.checkDue();
    const watch = (await service.watches(customer))[0]!;
    expect(watch.lastAmount).toBe(40000); expect(watch.matchedAt).not.toBeNull(); expect(flights.search).toHaveBeenCalledTimes(1);
  });
  it('does not turn a failed check into an available fare', async () => {
    await service.watch(customer, { search, targetAmount: 50000 });
    flights.search.mockRejectedValue(new Error('provider unavailable'));
    await service.checkDue();
    expect((await service.watches(customer))[0]).toMatchObject({ checkError: true, lastAmount: null, matchedAt: null });
  });
  async function request() {
    return (await db.query<{ id: string }>('INSERT INTO travel_support_requests(customer_id,conversation_id,action_id,reason) VALUES($1,$2,$3,$4) RETURNING id', [customer, conversation, action, 'Change flight'])).rows[0]!.id;
  }
  async function quoted(id: string, expiresAt = '2027-01-01T00:00:00Z') {
    await service.updateRequest(id, { expectedVersion: 1, stage: 'REVIEWING', message: 'Checking airline rules' }, staff, randomUUID());
    return service.updateRequest(id, { expectedVersion: 2, stage: 'QUOTE_READY', message: 'Fee ready', quote: { amount: 3000, currency: 'BDT', description: 'Airline and service fee', expiresAt } }, staff, randomUUID());
  }
  it('requires the owning customer to approve the latest unexpired quote exactly once', async () => {
    const id = await request(); const quote = await quoted(id);
    await expect(service.approve(other, id, quote.version)).rejects.toThrow();
    await expect(service.approve(customer, id, quote.version - 1)).rejects.toThrow();
    const approved = await service.approve(customer, id, quote.version);
    expect(approved.stage).toBe('APPROVED'); expect(approved.quote?.amount).toBe(3000);
    await expect(service.approve(customer, id, quote.version)).rejects.toThrow();
    expect((await service.requests(other))).toEqual([]);
  });
  it('blocks expired quotes and invalid staff transitions, and keeps an audit trail', async () => {
    const id = await request();
    await expect(service.updateRequest(id, { expectedVersion: 1, stage: 'COMPLETED', message: 'Skipped review' }, staff, randomUUID())).rejects.toThrow();
    await quoted(id);
    await db.query("UPDATE travel_support_requests SET quote=jsonb_set(quote,'{expiresAt}',to_jsonb('2020-01-01T00:00:00Z'::text)) WHERE id=$1", [id]);
    await expect(service.approve(customer, id, 3)).rejects.toThrow();
    expect((await db.query('SELECT * FROM admin_audit_events')).rows).toHaveLength(2);
  });
  it('shares conversation text only after a confirmed support record, excluding tool payloads', async () => {
    await expect(service.supportDetail(randomUUID())).rejects.toThrow();
    const id = await request();
    await db.query("INSERT INTO ai_messages(conversation_id,role,content,payload,created_at) VALUES($1,$2,$3,$4,now()-interval '1 hour')", [conversation, 'USER', 'Help with this flight', JSON.stringify({ privateDocumentUrl: 'secret' })]);
    await db.query("INSERT INTO ai_messages(conversation_id,role,content,created_at) VALUES($1,'USER','Future private discussion',now()+interval '1 hour')", [conversation]);
    const detail = await service.supportDetail(id);
    expect(detail.messages).toHaveLength(1); expect(JSON.stringify(detail)).not.toContain('secret'); expect(JSON.stringify(detail)).not.toContain('Future private');
  });
});
describe('budget and fare interpretation', () => {
  it('parses Bangla and English budgets without inventing prices', () => {
    expect(budgetIntent('Budget BDT 100,000 for two people')).toEqual({ total: 100000, adults: 2, currency: 'BDT' });
    expect(budgetIntent('বাজেট ৫০,০০০ টাকা দুই জন')).toEqual({ total: 50000, adults: 2, currency: 'BDT' });
    expect(budgetIntent('I need a flight on 2027-02-10')).toBeNull();
    expect(budgetIntent('budget 1000 USD for two people')).toBeNull();
  });
  it('excludes unknown, invalid and differently denominated fares', () => {
    expect(matchingFare([{ currency: 'USD', totalAmount: '20' }, { currency: 'BDT', totalAmount: 'NaN' }], 'BDT')).toBeNull();
  });
});
