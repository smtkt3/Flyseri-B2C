import 'reflect-metadata';
import { readFile } from 'node:fs/promises';
import { PGlite } from '@electric-sql/pglite';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { plainToInstance } from 'class-transformer';
import { validate } from 'class-validator';
import type { DatabaseConnection } from '@flyseri/database';
import type { HolidayBookingInput, HolidayPackage } from '@flyseri/types';
import { adminPermissions } from '../admin/admin-auth.js';
import { HolidayPackageDto, HolidayBookingDto } from './holiday.dto.js';
import { HolidayService, holidayTotal } from './holiday.service.js';

const staff = { staffUserId: '10000000-0000-4000-8000-000000000001', role: 'owner' as const };
const customer = '20000000-0000-4000-8000-000000000001';
const otherCustomer = '20000000-0000-4000-8000-000000000002';
const future = new Date(Date.now() + 30 * 86400000).toISOString().slice(0, 10);
const input: HolidayPackageDto = { title: 'Bangladesh beach escape', category: 'DOMESTIC', location: "Cox’s Bazar", countryCode: 'BD', imageUrl: 'https://images.unsplash.com/photo-1507525428034-b723cf961d3e', summary: 'A relaxed beach break in Bangladesh.', days: 2, nights: 1, adultPrice: 10000.25, childPrice: 5000.15, currency: 'BDT', maxPax: 5, departureDates: [future], inclusions: ['Hotel and breakfast'], exclusions: ['Flights'], itinerary: ['Arrive and relax.', 'Breakfast and departure.'], cancellationPolicy: 'Cancellation fees apply within 7 days of departure.', published: true, version: 0 };
const request: HolidayBookingInput = { packageId: '', packageVersion: 1, departureDate: future, adults: 2, children: 1, contactName: 'Test Customer', email: 'test@example.com', phone: '+8801700000000', idempotencyKey: '30000000-0000-4000-8000-000000000001' };
describe('holiday catalogue and booking persistence', () => {
  let db: PGlite, service: HolidayService, pkg: HolidayPackage;
  beforeAll(async () => {
    db = new PGlite();
    await db.exec('CREATE TABLE customers (id uuid PRIMARY KEY); CREATE TABLE admin_audit_events (staff_user_id uuid,staff_role text,event text,resource_type text,resource_id uuid,request_id text);');
    await db.exec(await readFile(new URL('../../../../packages/database/drizzle/0028_holiday_packages.sql', import.meta.url), 'utf8'));
    await db.query('INSERT INTO customers VALUES ($1),($2)', [customer, otherCustomer]);
    const query = async (sql: string, values: unknown[] = []) => db.query(sql, values.map(v => typeof v === 'object' && v !== null ? JSON.stringify(v) : v));
    const pool = { query, connect: async () => ({ query, release() {} }) };
    service = new HolidayService({ pool } as unknown as DatabaseConnection);
    pkg = await service.save(undefined, input, staff, 'test-create');
    request.packageId = pkg.id;
  });
  afterAll(async () => db?.close());
  it('publishes admin packages with BDT prices', async () => { expect((await service.list())[0]).toMatchObject({ title: input.title, currency: 'BDT', adultPrice: 10000.25, version: 1 }); });
  it('calculates integer minor units for mixed passengers', () => { expect(holidayTotal(pkg, request)).toBe(2500065); });
  it('rejects excess pax, zero adults, old dates and stale prices', () => {
    for (const change of [{ adults: 5, children: 1 }, { adults: 0 }, { children: -1 }, { adults: 1.5 }, { packageVersion: 99 }, { departureDate: '2020-01-01' }]) expect(() => holidayTotal(pkg, { ...request, ...change })).toThrow();
  });
  it('persists a pending request, and retries the same key without duplication', async () => {
    const first = await service.book(customer, request);
    const second = await service.book(customer, { ...request });
    expect(first.status).toBe('PENDING_CONFIRMATION'); expect(first.totalAmount).toBe(25000.65); expect(second.id).toBe(first.id);
    expect((await service.bookings(customer))).toHaveLength(1);
  });
  it('does not leak bookings to another customer', async () => { expect(await service.bookings(otherCustomer)).toEqual([]); });
  it('rejects a reused idempotency key with changed passengers', async () => { await expect(service.book(customer, { ...request, adults: 3 })).rejects.toThrow(); });
  it('retains quoted package and price snapshots after admin edits', async () => {
    pkg = await service.save(pkg.id, { ...input, adultPrice: 12000, version: 1 }, staff, 'test-edit');
    expect((await service.bookings(customer))[0]?.totalAmount).toBe(25000.65);
    await expect(service.book(customer, { ...request, idempotencyKey: '30000000-0000-4000-8000-000000000002' })).rejects.toThrow();
  });
  it('rejects lost admin updates and domestic countries outside BD', async () => {
    await expect(service.save(pkg.id, { ...input, version: 1 }, staff, 'test-stale')).rejects.toThrow();
    await expect(service.save(undefined, { ...input, countryCode: 'TH' }, staff, 'test-country')).rejects.toThrow();
  });
  it('processes pending bookings once and audits the change', async () => {
    const booking = (await service.bookings(customer))[0]!;
    expect((await service.status(booking.id, 'CONFIRMED', staff, 'test-confirm')).status).toBe('CONFIRMED');
    await expect(service.status(booking.id, 'CANCELLED', staff, 'test-replay')).rejects.toThrow();
    const { rows } = await db.query('SELECT event FROM admin_audit_events WHERE event=$1', ['holiday.booking.confirmed']); expect(rows).toHaveLength(1);
  });
  it('unpublishes without deleting existing bookings', async () => {
    await service.save(pkg.id, { ...input, version: pkg.version, published: false }, staff, 'test-hide');
    expect(await service.list()).toEqual([]); expect(await service.list(true)).toHaveLength(1); expect(await service.bookings(customer)).toHaveLength(1);
    await expect(service.detail(pkg.id)).rejects.toThrow();
  });
  it('limits admin holiday access to owner and manager', () => {
    expect(adminPermissions('owner')).toContain('holidays'); expect(adminPermissions('manager')).toContain('holidays');
    for (const role of ['support_staff','payment_staff','ticketing_staff'] as const) expect(adminPermissions(role)).not.toContain('holidays');
  });
  it('validates input and rejects injected browser totals and sample IDs', async () => {
    const errors = await validate(plainToInstance(HolidayBookingDto, { ...request, packageId: 'preview-bali', totalAmount: 1 }), { whitelist: true, forbidNonWhitelisted: true });
    expect(errors.map(e => e.property)).toEqual(expect.arrayContaining(['packageId', 'totalAmount']));
    expect(await validate(plainToInstance(HolidayPackageDto, input))).toHaveLength(0);
  });
});
