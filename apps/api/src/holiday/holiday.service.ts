import { randomUUID } from 'node:crypto';
import { Inject, Injectable } from '@nestjs/common';
import type { DatabaseConnection } from '@flyseri/database';
import type { HolidayBooking, HolidayBookingInput, HolidayPackage } from '@flyseri/types';
import type { PoolClient, QueryResultRow } from 'pg';
import { DATABASE_CONNECTION } from '../tokens.js';
import { ApiException } from '../api-exception.js';
import type { AdminIdentity } from '../admin/admin-auth.js';
import type { HolidayPackageDto } from './holiday.dto.js';

type PackageRow = { id: string; definition: Omit<HolidayPackage, 'id' | 'version'>; version: number; published: boolean };
type BookingRow = { id: string; reference: string; package_snapshot: HolidayPackage; request: HolidayBookingInput; total_minor: string; status: HolidayBooking['status']; created_at: Date };
const presentPackage = (r: PackageRow): HolidayPackage => ({ ...r.definition, id: r.id, version: r.version, published: r.published });
const presentBooking = (r: BookingRow): HolidayBooking => ({ id: r.id, reference: r.reference, packageTitle: r.package_snapshot.title, departureDate: r.request.departureDate, adults: r.request.adults, children: r.request.children, totalAmount: Number(r.total_minor) / 100, currency: 'BDT', status: r.status, createdAt: r.created_at.toISOString() });
const conflict = (message: string) => new ApiException('CONFLICT', message, 409);
const missing = () => new ApiException('NOT_FOUND', 'This holiday package is unavailable.', 404);
const dependencyError = (error: unknown) => error && typeof error === 'object' && 'code' in error && ['42P01', '42501'].includes(String(error.code))
  ? new ApiException('DEPENDENCY_UNAVAILABLE', 'Holiday package setup is pending. Please try again later.', 503) : error;
export const todayInDhaka = () => new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Dhaka', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
export function holidayTotal(pkg: HolidayPackage, input: Pick<HolidayBookingInput, 'adults' | 'children' | 'departureDate' | 'packageVersion'>): number {
  if (!Number.isInteger(input.adults) || !Number.isInteger(input.children) || input.adults < 1 || input.children < 0 || input.adults + input.children > pkg.maxPax) throw conflict(`Choose between 1 and ${pkg.maxPax} travellers, including an adult.`);
  if (pkg.version !== input.packageVersion) throw conflict('This package has changed. Refresh the package and review its latest price.');
  if (input.departureDate <= todayInDhaka() || !pkg.departureDates.includes(input.departureDate)) throw conflict('Choose an available future departure date.');
  return Math.round(pkg.adultPrice * 100) * input.adults + Math.round(pkg.childPrice * 100) * input.children;
}

@Injectable()
export class HolidayService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined) {}
  private get pool() {
    if (!this.connection) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Holiday packages are temporarily unavailable.', 503);
    return this.connection.pool;
  }
  private async query<T extends QueryResultRow>(sql: string, values: unknown[] = []) {
    try { return await this.pool.query<T>(sql, values); } catch (e) { throw dependencyError(e); }
  }
  async list(admin = false): Promise<HolidayPackage[]> {
    const result = await this.query<PackageRow>(`SELECT * FROM holiday_packages ${admin ? '' : 'WHERE published = true'} ORDER BY updated_at DESC LIMIT 200`);
    return result.rows.map(presentPackage).filter(p => admin || p.departureDates.some(date => date > todayInDhaka()));
  }
  async detail(id: string): Promise<HolidayPackage> {
    const { rows } = await this.query<PackageRow>('SELECT * FROM holiday_packages WHERE id = $1 AND published = true', [id]);
    if (!rows[0]) throw missing();
    return presentPackage(rows[0]);
  }
  private async audit(tx: PoolClient, staff: AdminIdentity, event: string, id: string, requestId: string) {
    await tx.query('INSERT INTO admin_audit_events (staff_user_id,staff_role,event,resource_type,resource_id,request_id) VALUES ($1,$2,$3,$4,$5,$6)', [staff.staffUserId, staff.role, event, 'holiday', id, requestId]);
  }
  async save(id: string | undefined, input: HolidayPackageDto, staff: AdminIdentity, requestId: string): Promise<HolidayPackage> {
    if ((input.category === 'DOMESTIC') !== (input.countryCode === 'BD')) throw conflict('Domestic packages must be in Bangladesh. Choose International for other countries.');
    if (input.nights >= input.days || input.itinerary.length !== input.days) throw conflict('Add one itinerary entry for each day and fewer nights than days.');
    if (new Set(input.departureDates).size !== input.departureDates.length || input.departureDates.some(d => !Number.isFinite(Date.parse(d)) || new Date(d).toISOString().slice(0, 10) !== d)) throw conflict('Use valid, unique departure dates.');
    if (input.published && !input.departureDates.some(d => d > todayInDhaka())) throw conflict('Add a future departure date before publishing.');
    const { version, ...definition } = input;
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      const result = id
        ? await tx.query<PackageRow>('UPDATE holiday_packages SET definition=$2,published=$3,version=version+1,updated_at=now() WHERE id=$1 AND version=$4 RETURNING *', [id, definition, input.published, version])
        : await tx.query<PackageRow>('INSERT INTO holiday_packages (definition,published) VALUES ($1,$2) RETURNING *', [definition, input.published]);
      const row = result.rows[0];
      if (!row) throw conflict('This package was edited by another staff member. Reload before saving.');
      await this.audit(tx, staff, id ? 'holiday.updated' : 'holiday.created', row.id, requestId);
      await tx.query('COMMIT');
      return presentPackage(row);
    } catch (e) { await tx.query('ROLLBACK'); throw dependencyError(e); } finally { tx.release(); }
  }
  async book(customerId: string, input: HolidayBookingInput): Promise<HolidayBooking> {
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      // Serialize retries for the same customer/key, even across API instances.
      await tx.query('SELECT pg_advisory_xact_lock(hashtextextended($1, 0))', [`${customerId}:${input.idempotencyKey}`]);
      const prior = await tx.query<BookingRow>('SELECT * FROM holiday_bookings WHERE customer_id=$1 AND idempotency_key=$2', [customerId, input.idempotencyKey]);
      if (prior.rows[0]) {
        if (Object.keys(input).some(key => prior.rows[0]!.request[key as keyof HolidayBookingInput] !== input[key as keyof HolidayBookingInput])) throw conflict('This request key was already used. Start a new booking.');
        await tx.query('COMMIT'); return presentBooking(prior.rows[0]);
      }
      const result = await tx.query<PackageRow>('SELECT * FROM holiday_packages WHERE id=$1 AND published=true FOR SHARE', [input.packageId]);
      if (!result.rows[0]) throw missing();
      const pkg = presentPackage(result.rows[0]);
      const total = holidayTotal(pkg, input);
      const row = await tx.query<BookingRow>('INSERT INTO holiday_bookings (reference,customer_id,package_id,package_snapshot,request,idempotency_key,total_minor) VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *', [`HOL-${randomUUID().slice(0, 8).toUpperCase()}`, customerId, pkg.id, pkg, input, input.idempotencyKey, total]);
      await tx.query('COMMIT');
      return presentBooking(row.rows[0]!);
    } catch (e) { await tx.query('ROLLBACK'); throw dependencyError(e); } finally { tx.release(); }
  }
  async bookings(customerId?: string) {
    const { rows } = await this.query<BookingRow>(`SELECT * FROM holiday_bookings ${customerId ? 'WHERE customer_id=$1' : ''} ORDER BY created_at DESC LIMIT 200`, customerId ? [customerId] : []);
    return rows.map(r => ({ ...presentBooking(r), ...(!customerId ? { contactName: r.request.contactName, email: r.request.email, phone: r.request.phone } : {}) }));
  }
  async status(id: string, status: 'CONFIRMED' | 'CANCELLED', staff: AdminIdentity, requestId: string) {
    const tx = await this.pool.connect();
    try {
      await tx.query('BEGIN');
      const result = await tx.query<BookingRow>("UPDATE holiday_bookings SET status=$2 WHERE id=$1 AND status='PENDING_CONFIRMATION' RETURNING *", [id, status]);
      if (!result.rows[0]) throw conflict('This booking was already processed or is unavailable.');
      await this.audit(tx, staff, `holiday.booking.${status.toLowerCase()}`, id, requestId);
      await tx.query('COMMIT'); return presentBooking(result.rows[0]);
    } catch (e) { await tx.query('ROLLBACK'); throw dependencyError(e); } finally { tx.release(); }
  }
}
