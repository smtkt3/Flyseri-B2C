import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, gte, ilike, inArray, isNotNull, isNull, lt, lte, notInArray, or, sql, type SQL } from 'drizzle-orm';
import { adminAuditEvents, auditEvents, crmSyncEvents, customerTravellers, customers, orders, payments, travellers, tripDestinations, tripTravellers, trips,
  visaApplications, visaApplicationNotes, visaApplicationRequirements, visaApplicationTravellers, visaReviewRequests, visaTypes, type DatabaseConnection } from '@flyseri/database';
import { ApiException } from '../api-exception.js';
import { DATABASE_CONNECTION } from '../tokens.js';
import { conditionMatches } from '../visa/visa-form.js';

export interface AdminListQuery { page: number; limit: number; search?: string; status?: string; customerId?: string; tripId?: string;
  paymentStatus?: string; createdFrom?: string; createdTo?: string; actionRequired?: boolean }
const pagination = (query: AdminListQuery) => ({ page: query.page, limit: query.limit, offset: (query.page - 1) * query.limit });
const page = <T>(items: T[], total: number, query: AdminListQuery) => ({ items, total, page: query.page, limit: query.limit });
const iso = (value: Date | null) => value?.toISOString() ?? null;
const missing = () => new ApiException('NOT_FOUND', 'Record not found.', 404);

@Injectable()
export class AdminRecordsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined) {}
  private get db() {
    if (!this.connection) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Flyseri data is unavailable.', 503);
    return this.connection.db;
  }

  async customers(query: AdminListQuery) {
    const db = this.db, { limit, offset } = pagination(query);
    const filters: SQL[] = [];
    if (query.customerId) filters.push(eq(customers.id, query.customerId));
    if (query.search) filters.push(ilike(customers.displayName, `%${query.search}%`));
    if (query.status) filters.push(eq(customers.status, query.status));
    const where = filters.length ? and(...filters) : undefined;
    const [rows, total] = await Promise.all([
      db.select({ id: customers.id, displayName: customers.displayName, phoneCountryCode: customers.phoneCountryCode,
        phoneNumber: customers.phoneNumber, status: customers.status, createdAt: customers.createdAt, updatedAt: customers.updatedAt })
        .from(customers).where(where).orderBy(desc(customers.createdAt), desc(customers.id)).limit(limit).offset(offset),
      db.select({ count: count() }).from(customers).where(where),
    ]);
    return page(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })), total[0]?.count ?? 0, query);
  }
  async customer(id: string) {
    const [row] = await this.db.select({ id: customers.id, displayName: customers.displayName, phoneCountryCode: customers.phoneCountryCode,
      phoneNumber: customers.phoneNumber, preferredLanguage: customers.preferredLanguage, preferredCurrency: customers.preferredCurrency,
      status: customers.status, createdAt: customers.createdAt, updatedAt: customers.updatedAt })
      .from(customers).where(eq(customers.id, id)).limit(1);
    if (!row) throw missing();
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }
  async customerActivity(id: string) {
    const [customer] = await this.db.select({ id: customers.id }).from(customers).where(eq(customers.id, id)).limit(1);
    if (!customer) throw missing();
    const [history, commerce] = await Promise.all([
      this.db.select({ event: auditEvents.event, createdAt: auditEvents.createdAt })
        .from(auditEvents).where(eq(auditEvents.actorCustomerId, id))
        .orderBy(desc(auditEvents.createdAt)).limit(30),
      this.db.select({ event: crmSyncEvents.eventType, createdAt: crmSyncEvents.createdAt })
        .from(crmSyncEvents).where(and(eq(crmSyncEvents.customerId, id), isNotNull(crmSyncEvents.sourceCommerceId)))
        .orderBy(desc(crmSyncEvents.createdAt)).limit(30),
    ]);
    return [...history, ...commerce].sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, 30).map((row) => ({ event: row.event, createdAt: row.createdAt.toISOString() }));
  }

  async travellers(query: AdminListQuery) {
    const db = this.db, { limit, offset } = pagination(query);
    const filters: SQL[] = [isNull(travellers.archivedAt)];
    if (query.customerId) filters.push(eq(customerTravellers.customerId, query.customerId));
    if (query.search) filters.push(sql`(${travellers.legalFirstName} ilike ${`%${query.search}%`} or ${travellers.legalLastName} ilike ${`%${query.search}%`})`);
    const where = and(...filters);
    const base = db.select({ id: travellers.id, customerId: customerTravellers.customerId, customerName: customers.displayName,
      legalFirstName: travellers.legalFirstName, legalLastName: travellers.legalLastName,
      relationshipType: customerTravellers.relationshipType, nationalityCountryCode: travellers.nationalityCountryCode,
      createdAt: travellers.createdAt }).from(customerTravellers)
      .innerJoin(travellers, eq(customerTravellers.travellerId, travellers.id))
      .innerJoin(customers, eq(customerTravellers.customerId, customers.id));
    const [rows, total] = await Promise.all([
      base.where(where).orderBy(desc(travellers.createdAt), desc(travellers.id)).limit(limit).offset(offset),
      db.select({ count: count() }).from(customerTravellers).innerJoin(travellers, eq(customerTravellers.travellerId, travellers.id)).where(where),
    ]);
    return page(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), total[0]?.count ?? 0, query);
  }
  async traveller(id: string) {
    const [row] = await this.db.select({ id: travellers.id, customerId: customerTravellers.customerId, customerName: customers.displayName,
      legalFirstName: travellers.legalFirstName, legalMiddleName: travellers.legalMiddleName, legalLastName: travellers.legalLastName,
      relationshipType: customerTravellers.relationshipType, nationalityCountryCode: travellers.nationalityCountryCode,
      createdAt: travellers.createdAt, updatedAt: travellers.updatedAt }).from(customerTravellers)
      .innerJoin(travellers, eq(customerTravellers.travellerId, travellers.id))
      .innerJoin(customers, eq(customerTravellers.customerId, customers.id))
      .where(and(eq(travellers.id, id), isNull(travellers.archivedAt))).limit(1);
    if (!row) throw missing();
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
  }

  async trips(query: AdminListQuery) {
    const db = this.db, { limit, offset } = pagination(query);
    const filters: SQL[] = [];
    if (query.customerId) filters.push(eq(trips.customerId, query.customerId));
    if (query.status === 'ARCHIVED') filters.push(sql`${trips.archivedAt} is not null`);
    else { filters.push(isNull(trips.archivedAt)); if (query.status) filters.push(eq(trips.status, query.status)); }
    if (query.search) filters.push(ilike(trips.title, `%${query.search}%`));
    const where = and(...filters);
    const [rows, total] = await Promise.all([
      db.select({ id: trips.id, customerId: trips.customerId, customerName: customers.displayName,
        title: trips.title, status: trips.status, startDate: trips.startDate, endDate: trips.endDate,
        destinationCountryCode: tripDestinations.countryCode, destinationCity: tripDestinations.cityName,
        travellerCount: sql<number>`(select count(*)::int from trip_travellers where trip_id = ${trips.id})`,
        updatedAt: trips.updatedAt, archivedAt: trips.archivedAt })
        .from(trips).innerJoin(customers, eq(trips.customerId, customers.id))
        .leftJoin(tripDestinations, and(eq(tripDestinations.tripId, trips.id), eq(tripDestinations.sequence, 1)))
        .where(where).orderBy(desc(trips.updatedAt), desc(trips.id)).limit(limit).offset(offset),
      db.select({ count: count() }).from(trips).where(where),
    ]);
    return page(rows.map((row) => ({ ...row, updatedAt: row.updatedAt.toISOString(), archivedAt: iso(row.archivedAt) })), total[0]?.count ?? 0, query);
  }
  async trip(id: string) {
    const db = this.db;
    const [row] = await db.select({ id: trips.id, customerId: trips.customerId, customerName: customers.displayName,
      title: trips.title, status: trips.status, startDate: trips.startDate, endDate: trips.endDate,
      createdAt: trips.createdAt, updatedAt: trips.updatedAt, archivedAt: trips.archivedAt })
      .from(trips).innerJoin(customers, eq(trips.customerId, customers.id)).where(eq(trips.id, id)).limit(1);
    if (!row) throw missing();
    const [destinations, participants] = await Promise.all([
      db.select({ countryCode: tripDestinations.countryCode, cityName: tripDestinations.cityName, sequence: tripDestinations.sequence,
        startDate: tripDestinations.startDate, endDate: tripDestinations.endDate })
        .from(tripDestinations).where(eq(tripDestinations.tripId, id)).orderBy(asc(tripDestinations.sequence)),
      db.select({ id: travellers.id, legalFirstName: travellers.legalFirstName, legalLastName: travellers.legalLastName })
        .from(tripTravellers).innerJoin(travellers, eq(tripTravellers.travellerId, travellers.id)).where(eq(tripTravellers.tripId, id)),
    ]);
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), archivedAt: iso(row.archivedAt), destinations, travellers: participants };
  }

  async visas(query: AdminListQuery) {
    const db = this.db, { limit, offset } = pagination(query);
    const filters: SQL[] = [isNull(visaApplications.archivedAt)];
    if (query.customerId) filters.push(eq(visaApplications.customerId, query.customerId));
    if (query.tripId) filters.push(eq(visaApplications.tripId, query.tripId));
    if (query.status) filters.push(eq(visaApplications.status, query.status));
    if (query.paymentStatus) filters.push(eq(payments.status, query.paymentStatus));
    if (query.createdFrom) filters.push(gte(visaApplications.createdAt, new Date(query.createdFrom)));
    if (query.createdTo) {
      const end = new Date(query.createdTo);
      if (/^\d{4}-\d{2}-\d{2}$/.test(query.createdTo)) {
        end.setUTCDate(end.getUTCDate() + 1);
        filters.push(lt(visaApplications.createdAt, end));
      } else filters.push(lte(visaApplications.createdAt, end));
    }
    if (query.search?.trim()) {
      const search = query.search.trim().slice(0, 100);
      const pattern = `%${search}%`;
      const terms: SQL[] = [ilike(visaApplications.applicationReference, pattern), ilike(customers.displayName, pattern),
        ilike(visaTypes.name, pattern), ilike(visaApplications.destinationCountryCode, pattern)];
      if (/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(search)) terms.push(eq(visaApplications.id, search));
      terms.push(inArray(visaApplications.id, db.select({ applicationId: visaApplicationTravellers.applicationId })
        .from(visaApplicationTravellers).innerJoin(travellers, eq(visaApplicationTravellers.travellerId, travellers.id))
        .where(sql`(${travellers.legalFirstName} ilike ${pattern} or ${travellers.legalLastName} ilike ${pattern})`)));
      filters.push(or(...terms)!);
    }
    if (query.actionRequired !== undefined) {
      const requestApplications = db.select({ applicationId: visaReviewRequests.applicationId }).from(visaReviewRequests)
        .where(eq(visaReviewRequests.status, 'OPEN'));
      const actionStatuses = ['ADDITIONAL_DOCUMENTS_REQUIRED', 'ADDITIONAL_INFORMATION_REQUIRED'];
      filters.push(query.actionRequired
        ? or(inArray(visaApplications.status, actionStatuses), inArray(visaApplications.id, requestApplications))!
        : and(notInArray(visaApplications.status, actionStatuses), notInArray(visaApplications.id, requestApplications))!);
    }
    const where = and(...filters);
    const [rows, total] = await Promise.all([
      db.select({ id: visaApplications.id, applicationReference: visaApplications.applicationReference,
        customerId: visaApplications.customerId, customerName: customers.displayName,
        tripId: visaApplications.tripId, tripTitle: trips.title, visaType: visaTypes.name,
        destinationCountryCode: visaApplications.destinationCountryCode, status: visaApplications.status,
        createdAt: visaApplications.createdAt, submittedAt: visaApplications.submittedAt, updatedAt: visaApplications.updatedAt,
        answers: visaApplications.answers })
        .from(visaApplications).innerJoin(customers, eq(visaApplications.customerId, customers.id))
        .innerJoin(trips, eq(visaApplications.tripId, trips.id)).innerJoin(visaTypes, eq(visaApplications.visaTypeId, visaTypes.id))
        .leftJoin(orders, eq(orders.visaApplicationId, visaApplications.id)).leftJoin(payments, eq(payments.orderId, orders.id))
        .where(where).orderBy(desc(visaApplications.updatedAt), desc(visaApplications.id)).limit(limit).offset(offset),
      db.select({ count: count() }).from(visaApplications).innerJoin(customers, eq(visaApplications.customerId, customers.id))
        .innerJoin(trips, eq(visaApplications.tripId, trips.id)).innerJoin(visaTypes, eq(visaApplications.visaTypeId, visaTypes.id))
        .leftJoin(orders, eq(orders.visaApplicationId, visaApplications.id)).leftJoin(payments, eq(payments.orderId, orders.id)).where(where),
    ]);
    if (!rows.length) return page([], total[0]?.count ?? 0, query);
    const ids = rows.map((row) => row.id);
    const [people, requirements, customerNotes, openRequests, applicationOrders] = await Promise.all([
      db.select({ applicationId: visaApplicationTravellers.applicationId, id: travellers.id,
        legalFirstName: travellers.legalFirstName, legalLastName: travellers.legalLastName })
        .from(visaApplicationTravellers).innerJoin(travellers, eq(visaApplicationTravellers.travellerId, travellers.id))
        .where(inArray(visaApplicationTravellers.applicationId, ids)),
      db.select({ applicationId: visaApplicationRequirements.applicationId, travellerId: visaApplicationRequirements.travellerId,
        required: visaApplicationRequirements.requiredSnapshot, status: visaApplicationRequirements.status,
        conditions: visaApplicationRequirements.conditionSnapshot })
        .from(visaApplicationRequirements).where(inArray(visaApplicationRequirements.applicationId, ids)),
      db.select({ applicationId: visaApplicationNotes.applicationId, id: visaApplicationNotes.id })
        .from(visaApplicationNotes).where(and(inArray(visaApplicationNotes.applicationId, ids), eq(visaApplicationNotes.visibility, 'CUSTOMER'))),
      db.select({ applicationId: visaReviewRequests.applicationId, id: visaReviewRequests.id })
        .from(visaReviewRequests).where(and(inArray(visaReviewRequests.applicationId, ids), eq(visaReviewRequests.status, 'OPEN'))),
      db.select({ applicationId: orders.visaApplicationId, orderStatus: orders.status, paymentStatus: payments.status,
        paidAt: payments.paidAt, amount: orders.totalAmount, currency: orders.currency })
        .from(orders).leftJoin(payments, eq(payments.orderId, orders.id)).where(inArray(orders.visaApplicationId, ids)),
    ]);
    return page(rows.map((row) => {
      const applicants = people.filter((person) => person.applicationId === row.id).map(({ applicationId: _applicationId, ...person }) => person);
      const answers = row.answers as Record<string, Record<string, unknown>>;
      const applicableRequirements = requirements.filter((item) => item.applicationId === row.id && item.required &&
        conditionMatches(item.conditions, { ...(answers.application ?? {}), ...(answers[item.travellerId] ?? {}) }));
      const requiredReceived = applicableRequirements.filter((item) => ['UPLOADED', 'UNDER_REVIEW', 'ACCEPTED'].includes(item.status)).length;
      const order = applicationOrders.find((item) => item.applicationId === row.id);
      return { id: row.id, applicationReference: row.applicationReference, customerId: row.customerId, customerName: row.customerName,
        tripId: row.tripId, tripTitle: row.tripTitle, visaType: row.visaType, destinationCountryCode: row.destinationCountryCode,
        applicants, status: row.status, createdAt: row.createdAt.toISOString(), submittedAt: row.submittedAt?.toISOString() ?? null,
        updatedAt: row.updatedAt.toISOString(), paymentStatus: order?.paymentStatus ?? null, orderStatus: order?.orderStatus ?? null,
        paidAt: order?.paidAt?.toISOString() ?? null, totalAmount: order?.amount ?? null, currency: order?.currency ?? null,
        requiredDocumentsReceived: requiredReceived, requiredDocumentsTotal: applicableRequirements.length,
        openCorrectionCount: openRequests.filter((request) => request.applicationId === row.id).length,
        customerUpdateCount: customerNotes.filter((note) => note.applicationId === row.id).length };
    }), total[0]?.count ?? 0, query);
  }
  async visa(id: string) {
    const db = this.db;
    const [row] = await db.select({ id: visaApplications.id, customerId: visaApplications.customerId, customerName: customers.displayName,
      tripId: visaApplications.tripId, tripTitle: trips.title, visaType: visaTypes.name,
      destinationCountryCode: visaApplications.destinationCountryCode, status: visaApplications.status,
      createdAt: visaApplications.createdAt, updatedAt: visaApplications.updatedAt })
      .from(visaApplications).innerJoin(customers, eq(visaApplications.customerId, customers.id))
      .innerJoin(trips, eq(visaApplications.tripId, trips.id)).innerJoin(visaTypes, eq(visaApplications.visaTypeId, visaTypes.id))
      .where(eq(visaApplications.id, id)).limit(1);
    if (!row) throw missing();
    const participants = await db.select({ id: travellers.id, legalFirstName: travellers.legalFirstName, legalLastName: travellers.legalLastName })
      .from(visaApplicationTravellers).innerJoin(travellers, eq(visaApplicationTravellers.travellerId, travellers.id))
      .where(eq(visaApplicationTravellers.applicationId, id));
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(), travellers: participants };
  }

  async audit(query: AdminListQuery) {
    const db = this.db, { limit, offset } = pagination(query);
    const [rows, total] = await Promise.all([
      db.select({ event: adminAuditEvents.event, resourceType: adminAuditEvents.resourceType,
        staffRole: adminAuditEvents.staffRole, createdAt: adminAuditEvents.createdAt })
        .from(adminAuditEvents).orderBy(desc(adminAuditEvents.createdAt)).limit(limit).offset(offset),
      db.select({ count: count() }).from(adminAuditEvents),
    ]);
    return page(rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString() })), total[0]?.count ?? 0, query);
  }
}
