import { and, asc, eq, gte, inArray, isNotNull, isNull, lt } from 'drizzle-orm';
import { auditEvents, customerTravellers, travellers, tripDestinations, tripTravellers, trips, type DatabaseConnection } from '@flyseri/database';
import type { TripDestination, TripDestinationInput, TripDetail, TripInput, TripStatus, TripSummary, TripTraveller } from '@flyseri/types';

export class TripTravellerUnavailableError extends Error {}
export class TripConflictError extends Error {}
export class TripDateError extends Error {}
export interface TripListFilter { status?: TripStatus; period?: 'upcoming' | 'past'; archived?: boolean }
export interface TripStore {
  list(customerId: string, filter: TripListFilter): Promise<TripSummary[]>;
  detail(customerId: string, tripId: string): Promise<TripDetail | null>;
  create(customerId: string, input: TripInput): Promise<TripDetail>;
  update(customerId: string, tripId: string, input: Partial<TripInput>): Promise<TripDetail | null>;
  archive(customerId: string, tripId: string): Promise<boolean>;
  addTraveller(customerId: string, tripId: string, travellerId: string): Promise<TripDetail | null>;
  removeTraveller(customerId: string, tripId: string, travellerId: string): Promise<boolean>;
  addDestination(customerId: string, tripId: string, input: TripDestinationInput): Promise<TripDetail | null>;
  updateDestination(customerId: string, tripId: string, destinationId: string, input: Partial<TripDestinationInput>): Promise<TripDetail | null>;
  removeDestination(customerId: string, tripId: string, destinationId: string): Promise<boolean>;
}

type TripRow = typeof trips.$inferSelect;
type DestinationRow = typeof tripDestinations.$inferSelect;
const dateOnly = (value: unknown): string | null => value instanceof Date ? value.toISOString().slice(0, 10) : typeof value === 'string' ? value : null;
const destination = (row: DestinationRow): TripDestination => ({ id: row.id, countryCode: row.countryCode, cityName: row.cityName, sequence: row.sequence, startDate: dateOnly(row.startDate), endDate: dateOnly(row.endDate) });
const summary = (row: TripRow, destinations: DestinationRow[], travellerCount: number): TripSummary => ({
  id: row.id, title: row.title, status: row.status as TripStatus, startDate: dateOnly(row.startDate), endDate: dateOnly(row.endDate),
  primaryDestination: destinations[0] ? { countryCode: destinations[0].countryCode, cityName: destinations[0].cityName } : null,
  travellerCount, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
});
export function assertDates(start: string | null | undefined, end: string | null | undefined): void {
  if (start && end && end < start) throw new TripDateError('End date must be on or after start date');
}

export class DrizzleTripStore implements TripStore {
  constructor(private readonly connection: DatabaseConnection) {}

  async list(customerId: string, filter: TripListFilter): Promise<TripSummary[]> {
    const today = new Date().toISOString().slice(0, 10);
    const conditions = [eq(trips.customerId, customerId), filter.archived ? isNotNull(trips.archivedAt) : isNull(trips.archivedAt)];
    if (filter.status) conditions.push(eq(trips.status, filter.status));
    if (filter.period === 'upcoming') conditions.push(gte(trips.startDate, today));
    if (filter.period === 'past') conditions.push(lt(trips.endDate, today));
    const rows = await this.connection.db.select().from(trips).where(and(...conditions)).orderBy(asc(trips.createdAt));
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [destinations, links] = await Promise.all([
      this.connection.db.select().from(tripDestinations).where(inArray(tripDestinations.tripId, ids)).orderBy(asc(tripDestinations.sequence)),
      this.connection.db.select({ tripId: tripTravellers.tripId }).from(tripTravellers).where(inArray(tripTravellers.tripId, ids)),
    ]);
    const destinationMap = new Map<string, DestinationRow[]>();
    for (const item of destinations) destinationMap.set(item.tripId, [...(destinationMap.get(item.tripId) ?? []), item]);
    const counts = new Map<string, number>();
    for (const link of links) counts.set(link.tripId, (counts.get(link.tripId) ?? 0) + 1);
    return rows.map((row) => summary(row, destinationMap.get(row.id) ?? [], counts.get(row.id) ?? 0));
  }

  async detail(customerId: string, tripId: string): Promise<TripDetail | null> {
    const [row] = await this.connection.db.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).limit(1);
    if (!row) return null;
    const [destinationRows, people] = await Promise.all([
      this.connection.db.select().from(tripDestinations).where(eq(tripDestinations.tripId, tripId)).orderBy(asc(tripDestinations.sequence)),
      this.connection.db.select({ id: travellers.id, first: travellers.legalFirstName, last: travellers.legalLastName, relationship: customerTravellers.relationshipType })
        .from(tripTravellers).innerJoin(travellers, eq(tripTravellers.travellerId, travellers.id))
        .innerJoin(customerTravellers, and(eq(customerTravellers.travellerId, travellers.id), eq(customerTravellers.customerId, customerId)))
        .where(eq(tripTravellers.tripId, tripId)),
    ]);
    const tripPeople: TripTraveller[] = people.map((person) => ({ id: person.id, legalFirstName: person.first, legalLastName: person.last, relationshipType: person.relationship as TripTraveller['relationshipType'] }));
    return { ...summary(row, destinationRows, tripPeople.length), destinations: destinationRows.map(destination), travellers: tripPeople };
  }

  private async validTravellerIds(tx: Parameters<Parameters<DatabaseConnection['db']['transaction']>[0]>[0], customerId: string, ids: string[]): Promise<void> {
    if (new Set(ids).size !== ids.length) throw new TripConflictError('Duplicate traveller');
    if (!ids.length) return;
    const owned = await tx.select({ id: travellers.id }).from(customerTravellers).innerJoin(travellers, eq(customerTravellers.travellerId, travellers.id))
      .where(and(eq(customerTravellers.customerId, customerId), inArray(travellers.id, ids), isNull(travellers.archivedAt)));
    if (owned.length !== ids.length) throw new TripTravellerUnavailableError('Selected traveller is unavailable');
  }

  async create(customerId: string, input: TripInput): Promise<TripDetail> {
    const id = await this.connection.db.transaction(async (tx) => {
      const ids = input.travellerIds ?? [];
      await this.validTravellerIds(tx, customerId, ids);
      const [row] = await tx.insert(trips).values({ customerId, title: input.title ?? null, status: input.status ?? 'PLANNING', startDate: input.startDate ?? null, endDate: input.endDate ?? null }).returning({ id: trips.id });
      if (!row) throw new Error('Trip creation failed');
      if (input.destinations?.length) await tx.insert(tripDestinations).values(input.destinations.map((item, index) => ({ tripId: row.id, countryCode: item.countryCode, cityName: item.cityName ?? null, startDate: item.startDate ?? null, endDate: item.endDate ?? null, sequence: index + 1 })));
      if (ids.length) await tx.insert(tripTravellers).values(ids.map((travellerId) => ({ tripId: row.id, travellerId })));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: row.id, event: 'trip.created' });
      return row.id;
    });
    const result = await this.detail(customerId, id);
    if (!result) throw new Error('Created trip missing');
    return result;
  }

  async update(customerId: string, tripId: string, input: Partial<TripInput>): Promise<TripDetail | null> {
    const updated = await this.connection.db.transaction(async (tx) => {
      const [current] = await tx.select().from(trips).where(and(eq(trips.id, tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).limit(1);
      if (!current) return false;
      assertDates(input.startDate === undefined ? dateOnly(current.startDate) : input.startDate, input.endDate === undefined ? dateOnly(current.endDate) : input.endDate);
      await tx.update(trips).set({ title: input.title === undefined ? current.title : input.title, status: input.status ?? current.status, startDate: input.startDate === undefined ? current.startDate : input.startDate, endDate: input.endDate === undefined ? current.endDate : input.endDate, updatedAt: new Date() }).where(eq(trips.id, tripId));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId, event: 'trip.updated' });
      return true;
    });
    return updated ? this.detail(customerId, tripId) : null;
  }

  async archive(customerId: string, tripId: string): Promise<boolean> {
    return this.connection.db.transaction(async (tx) => {
      const [row] = await tx.update(trips).set({ archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(trips.id, tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).returning({ id: trips.id });
      if (!row) return false;
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId, event: 'trip.archived' });
      return true;
    });
  }

  async addTraveller(customerId: string, tripId: string, travellerId: string): Promise<TripDetail | null> {
    const found = await this.connection.db.transaction(async (tx) => {
      const [trip] = await tx.select({ id: trips.id }).from(trips).where(and(eq(trips.id, tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).limit(1);
      if (!trip) return false;
      await this.validTravellerIds(tx, customerId, [travellerId]);
      const [existing] = await tx.select({ id: tripTravellers.id }).from(tripTravellers).where(and(eq(tripTravellers.tripId, tripId), eq(tripTravellers.travellerId, travellerId))).limit(1);
      if (existing) throw new TripConflictError('Traveller already on trip');
      await tx.insert(tripTravellers).values({ tripId, travellerId });
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId, travellerId, event: 'trip.traveller.added' });
      return true;
    });
    return found ? this.detail(customerId, tripId) : null;
  }

  async removeTraveller(customerId: string, tripId: string, travellerId: string): Promise<boolean> {
    return this.connection.db.transaction(async (tx) => {
      const [trip] = await tx.select({ id: trips.id }).from(trips).where(and(eq(trips.id, tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).limit(1);
      if (!trip) return false;
      const [removed] = await tx.delete(tripTravellers).where(and(eq(tripTravellers.tripId, tripId), eq(tripTravellers.travellerId, travellerId))).returning({ id: tripTravellers.id });
      if (!removed) return false;
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId, travellerId, event: 'trip.traveller.removed' });
      return true;
    });
  }

  async addDestination(customerId: string, tripId: string, input: TripDestinationInput): Promise<TripDetail | null> {
    const found = await this.connection.db.transaction(async (tx) => {
      const [trip] = await tx.select({ id: trips.id }).from(trips).where(and(eq(trips.id, tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).limit(1);
      if (!trip) return false;
      const existing = await tx.select({ sequence: tripDestinations.sequence }).from(tripDestinations).where(eq(tripDestinations.tripId, tripId));
      if (existing.length >= 12) throw new TripConflictError('Too many destinations');
      const sequence = Math.max(0, ...existing.map((item) => item.sequence)) + 1;
      await tx.insert(tripDestinations).values({ tripId, sequence, countryCode: input.countryCode, cityName: input.cityName ?? null, startDate: input.startDate ?? null, endDate: input.endDate ?? null });
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId, event: 'trip.destination.added' });
      return true;
    });
    return found ? this.detail(customerId, tripId) : null;
  }

  async updateDestination(customerId: string, tripId: string, destinationId: string, input: Partial<TripDestinationInput>): Promise<TripDetail | null> {
    const found = await this.connection.db.transaction(async (tx) => {
      const [current] = await tx.select({ destination: tripDestinations }).from(tripDestinations).innerJoin(trips, eq(tripDestinations.tripId, trips.id))
        .where(and(eq(trips.id, tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt), eq(tripDestinations.id, destinationId))).limit(1);
      if (!current) return false;
      assertDates(input.startDate === undefined ? dateOnly(current.destination.startDate) : input.startDate, input.endDate === undefined ? dateOnly(current.destination.endDate) : input.endDate);
      await tx.update(tripDestinations).set({ countryCode: input.countryCode ?? current.destination.countryCode, cityName: input.cityName === undefined ? current.destination.cityName : input.cityName, startDate: input.startDate === undefined ? current.destination.startDate : input.startDate, endDate: input.endDate === undefined ? current.destination.endDate : input.endDate }).where(eq(tripDestinations.id, destinationId));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId, event: 'trip.destination.updated' });
      return true;
    });
    return found ? this.detail(customerId, tripId) : null;
  }

  async removeDestination(customerId: string, tripId: string, destinationId: string): Promise<boolean> {
    return this.connection.db.transaction(async (tx) => {
      const [trip] = await tx.select({ id: trips.id }).from(trips).where(and(eq(trips.id, tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).limit(1);
      if (!trip) return false;
      const [removed] = await tx.delete(tripDestinations).where(and(eq(tripDestinations.tripId, tripId), eq(tripDestinations.id, destinationId))).returning({ id: tripDestinations.id });
      if (!removed) return false;
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId, event: 'trip.destination.removed' });
      return true;
    });
  }
}
