import { and, asc, desc, eq, inArray, isNull, isNotNull, lte, or, gte } from 'drizzle-orm';
import { auditEvents, customerTravellers, customers, documentVersions, documents, orders, orderItems, payments, travellers, tripDestinations, tripTravellers, trips, visaApplicationNotes, visaApplicationRequirements, visaApplicationTravellers, visaApplications, visaAssistanceRequestDocuments, visaAssistanceRequestTravellers, visaAssistanceRequests, visaRequirementDocuments, visaRequirements, visaReviewRequests, visaServiceVersions, visaStatusHistory, visaTypes, type DatabaseConnection } from '@flyseri/database';
import type { VisaApplicationDetail, VisaApplicationRequirement, VisaApplicationStatus, VisaApplicationSummary, VisaAssistanceRequestDetail, VisaAssistanceApplicantInput, VisaAssistanceRequestInput, VisaAssistanceRequestSummary, VisaFormDefinition, VisaReviewRequest, VisaTimelineItem, VisaRequirementDocument, VisaType } from '@flyseri/types';
import { VisaConflictError, VisaValidationError } from './visa.errors.js';
import { conditionMatches, parseVisaFormDefinition, validateVisaAnswers } from './visa-form.js';
export interface VisaStore {
  saveAssistanceForm(customerId: string, id: string, input: VisaAssistanceRequestInput): Promise<VisaAssistanceRequestDetail | null>;
  assistanceList(customerId: string): Promise<VisaAssistanceRequestSummary[]>;
  assistanceDetail(customerId: string, id: string): Promise<VisaAssistanceRequestDetail | null>;
  assistanceAction(customerId: string, id: string, action: 'LINK' | 'UNLINK' | 'SUBMIT' | 'NOTE', input?: { travellerId?: string; documentId?: string; documentVersionId?: string; linkId?: string; customerMessage?: string }): Promise<VisaAssistanceRequestDetail | null>;
  catalogue(countryCode: string): Promise<VisaType[]>;
  types(customerId: string, tripId: string): Promise<VisaType[] | null>;
  list(customerId: string, tripId?: string): Promise<VisaApplicationSummary[]>;
  detail(customerId: string, applicationId: string): Promise<VisaApplicationDetail | null>;
  create(customerId: string, tripId: string, visaTypeId: string, travellerIds: string[]): Promise<VisaApplicationDetail | null>;
  action(customerId: string, applicationId: string, action: 'MARK_INCOMPLETE' | 'SUBMIT_DOCUMENTS'): Promise<VisaApplicationDetail | null>;
  archive(customerId: string, applicationId: string): Promise<boolean>;
  link(customerId: string, applicationId: string, requirementId: string, documentId: string, versionId: string): Promise<VisaApplicationDetail | null>;
  unlink(customerId: string, applicationId: string, requirementId: string, documentId: string): Promise<VisaApplicationDetail | null>;
  saveAnswers(customerId: string, applicationId: string, scope: string, answers: Record<string, unknown>): Promise<VisaApplicationDetail | null>;
  submit(customerId: string, applicationId: string, declarationVersion: string): Promise<VisaApplicationDetail | null>;
  createAssistanceRequest(customerId: string, input: VisaAssistanceRequestInput): Promise<VisaAssistanceRequestSummary>;
}

type ApplicationRow = typeof visaApplications.$inferSelect;
const today = () => new Date().toISOString().slice(0, 10);
const ageAt = (birth: string, at: string) => {
  const years = Number(at.slice(0, 4)) - Number(birth.slice(0, 4));
  return years - (at.slice(5) < birth.slice(5) ? 1 : 0);
};
function applicable(rule: typeof visaRequirements.$inferSelect, person: typeof travellers.$inferSelect, at: string): boolean {
  if (rule.nationalityCountryCode) {
    if (!person.nationalityCountryCode) throw new VisaValidationError('Traveller nationality is required');
    if (rule.nationalityCountryCode !== person.nationalityCountryCode) return false;
  }
  if (rule.minAge !== null || rule.maxAge !== null) {
    if (!person.dateOfBirth) throw new VisaValidationError('Traveller date of birth is required');
    const age = ageAt(person.dateOfBirth, at);
    if (rule.minAge !== null && age < rule.minAge) return false;
    if (rule.maxAge !== null && age > rule.maxAge) return false;
  }
  return true;
}
export class DrizzleVisaStore implements VisaStore {
  constructor(private readonly connection: DatabaseConnection) {}
  async saveAssistanceForm(customerId: string, id: string, input: VisaAssistanceRequestInput): Promise<VisaAssistanceRequestDetail | null> {
    const travellerIds = input.applicants.map(person => person.travellerId);
    if (!travellerIds.length || travellerIds.length > 30 || new Set(travellerIds).size !== travellerIds.length) throw new VisaValidationError('Choose each applicant once');
    if (input.expectedReturnDate && input.expectedReturnDate < input.expectedTravelDate) throw new VisaValidationError('The expected return date must be after departure');
    for (const person of input.applicants) {
      if (person.dateOfBirth >= today()) throw new VisaValidationError('Check each applicant’s date of birth');
      if (person.documentIssuedOn && person.documentIssuedOn > person.documentExpiresOn) throw new VisaValidationError('Document expiry must follow its issue date');
    }
    const found = await this.connection.db.transaction(async tx => {
      const [request] = await tx.select().from(visaAssistanceRequests).where(and(eq(visaAssistanceRequests.id, id), eq(visaAssistanceRequests.customerId, customerId))).for('update');
      if (!request) return false;
      if (request.status !== 'NEW') throw new VisaConflictError('This request has already been submitted');
      if (request.tripId !== input.tripId || request.destinationCountryCode !== input.destinationCountryCode || request.expectedTravelDate !== input.expectedTravelDate || request.purpose !== input.purpose) throw new VisaValidationError('Keep the saved visa selection for this application');
      const [trip] = await tx.select({id: trips.id}).from(trips).where(and(eq(trips.id, request.tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).limit(1);
      if (!trip) throw new VisaValidationError('Choose one of your saved journeys');
      const people = await tx.select({id: travellers.id}).from(tripTravellers)
        .innerJoin(customerTravellers, and(eq(customerTravellers.travellerId, tripTravellers.travellerId), eq(customerTravellers.customerId, customerId)))
        .innerJoin(travellers, and(eq(travellers.id, tripTravellers.travellerId), isNull(travellers.archivedAt)))
        .where(and(eq(tripTravellers.tripId, request.tripId), inArray(tripTravellers.travellerId, travellerIds)));
      if (people.length !== travellerIds.length) throw new VisaValidationError('Every applicant must be a saved traveller on this journey');
      const existing = await tx.select().from(visaAssistanceRequestTravellers).where(eq(visaAssistanceRequestTravellers.requestId, id));
      const removed = existing.filter(person => !travellerIds.includes(person.travellerId));
      const membershipChanged = removed.length > 0 || existing.length !== travellerIds.length;
      if (membershipChanged) {
        const [order] = await tx.select({id: orders.id}).from(orders).innerJoin(orderItems, eq(orderItems.orderId, orders.id))
          .where(and(eq(orderItems.referenceId, id), eq(orderItems.itemType, 'VISA_SERVICE'), eq(orders.customerId, customerId))).limit(1);
        if (order) throw new VisaValidationError('The applicant list is locked after payment preparation. Contact Flyseri to change it.');
      }
      if (removed.length) {
        const removedIds = removed.map(person => person.travellerId);
        const [attachment] = await tx.select({id: visaAssistanceRequestDocuments.id}).from(visaAssistanceRequestDocuments).where(and(eq(visaAssistanceRequestDocuments.requestId, id), inArray(visaAssistanceRequestDocuments.travellerId, removedIds))).limit(1);
        if (attachment) throw new VisaValidationError('Remove the applicant’s attachments before removing the applicant');
        await tx.delete(visaAssistanceRequestTravellers).where(and(eq(visaAssistanceRequestTravellers.requestId, id), inArray(visaAssistanceRequestTravellers.travellerId, removedIds)));
      }
      for (const person of input.applicants) {
        const applicantDetails = person as unknown as Record<string, unknown>;
        if (existing.some(saved => saved.travellerId === person.travellerId)) await tx.update(visaAssistanceRequestTravellers).set({applicantDetails}).where(and(eq(visaAssistanceRequestTravellers.requestId, id), eq(visaAssistanceRequestTravellers.travellerId, person.travellerId)));
        else await tx.insert(visaAssistanceRequestTravellers).values({requestId: id, travellerId: person.travellerId, applicantDetails});
      }
      await tx.update(visaAssistanceRequests).set({expectedReturnDate: input.expectedReturnDate || null, accommodationOrHost: input.accommodationOrHost?.trim() || null,
        contactName: input.contactName.trim(), contactEmail: input.contactEmail.trim().toLowerCase(), contactPhone: input.contactPhone?.trim() || null,
        customerMessage: input.customerMessage?.trim() || null, updatedAt: new Date()}).where(eq(visaAssistanceRequests.id, id));
      await tx.insert(auditEvents).values({actorCustomerId: customerId, tripId: request.tripId, event: 'visa.assistance.form.saved'});
      return true;
    });
    return found ? this.assistanceDetail(customerId, id) : null;
  }
  async createAssistanceRequest(customerId: string, input: VisaAssistanceRequestInput): Promise<VisaAssistanceRequestSummary> {
    const travellerIds = input.applicants.map(({ travellerId }) => travellerId);
    if (!travellerIds.length || new Set(travellerIds).size !== travellerIds.length) throw new VisaValidationError('Choose each applicant once');
    const parsedDate = new Date(`${input.expectedTravelDate}T00:00:00.000Z`);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expectedTravelDate) || Number.isNaN(parsedDate.getTime()) || parsedDate.toISOString().slice(0, 10) !== input.expectedTravelDate || input.expectedTravelDate < today()) {
      throw new VisaValidationError('Choose a valid future travel date');
    }
    if (input.expectedReturnDate && input.expectedReturnDate < input.expectedTravelDate) throw new VisaValidationError('The expected return date must be after departure');
    for (const applicant of input.applicants) {
      if (applicant.dateOfBirth >= today()) throw new VisaValidationError('Check each applicant’s date of birth');
      if (applicant.documentIssuedOn && applicant.documentIssuedOn > applicant.documentExpiresOn) throw new VisaValidationError('Document expiry must follow its issue date');
    }
    return this.connection.db.transaction(async (tx) => {
      const [trip] = await tx.select({ id: trips.id }).from(trips)
        .where(and(eq(trips.id, input.tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).limit(1);
      if (!trip) throw new VisaValidationError('Choose one of your saved journeys');
      const [destination] = await tx.select({ id: tripDestinations.id }).from(tripDestinations)
        .where(and(eq(tripDestinations.tripId, trip.id), eq(tripDestinations.countryCode, input.destinationCountryCode))).limit(1);
      if (!destination) throw new VisaValidationError('The destination must match this journey');
      const people = await tx.select({ id: travellers.id }).from(tripTravellers)
        .innerJoin(customerTravellers, and(eq(customerTravellers.travellerId, tripTravellers.travellerId), eq(customerTravellers.customerId, customerId)))
        .innerJoin(travellers, and(eq(travellers.id, tripTravellers.travellerId), isNull(travellers.archivedAt)))
        .where(and(eq(tripTravellers.tripId, trip.id), inArray(tripTravellers.travellerId, travellerIds)));
      if (people.length !== travellerIds.length) throw new VisaValidationError('Every applicant must be a saved traveller on this journey');
      const [request] = await tx.insert(visaAssistanceRequests).values({
        customerId, tripId: trip.id, destinationCountryCode: input.destinationCountryCode,
        expectedTravelDate: input.expectedTravelDate, expectedReturnDate: input.expectedReturnDate || null,
        purpose: input.purpose, accommodationOrHost: input.accommodationOrHost?.trim() || null,
        contactName: input.contactName.trim(), contactEmail: input.contactEmail.trim().toLowerCase(),
        contactPhone: input.contactPhone?.trim() || null, customerMessage: input.customerMessage?.trim() || null,
      }).returning();
      if (!request) throw new Error('Visa assistance request creation failed');
      await tx.insert(visaAssistanceRequestTravellers).values(input.applicants.map((applicant) => ({
        requestId: request.id, travellerId: applicant.travellerId,
        applicantDetails: applicant as unknown as Record<string, unknown>,
      })));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: trip.id, event: 'visa.assistance.request.created' });
      return { id: request.id, requestReference: request.requestReference, tripId: request.tripId,
        destinationCountryCode: request.destinationCountryCode, expectedTravelDate: request.expectedTravelDate,
        purpose: request.purpose, status: request.status as VisaAssistanceRequestSummary['status'], createdAt: request.createdAt.toISOString() };
    });
  }
  async assistanceList(customerId: string): Promise<VisaAssistanceRequestSummary[]> {
    const rows = await this.connection.db.select().from(visaAssistanceRequests).where(eq(visaAssistanceRequests.customerId, customerId)).orderBy(desc(visaAssistanceRequests.createdAt)).limit(200);
    return rows.map(row => ({ id: row.id, requestReference: row.requestReference, tripId: row.tripId, destinationCountryCode: row.destinationCountryCode, expectedTravelDate: row.expectedTravelDate, purpose: row.purpose, status: row.status as VisaAssistanceRequestSummary['status'], createdAt: row.createdAt.toISOString() }));
  }
  async assistanceDetail(customerId: string, id: string): Promise<VisaAssistanceRequestDetail | null> {
    const [row] = await this.connection.db.select().from(visaAssistanceRequests).where(and(eq(visaAssistanceRequests.id, id), eq(visaAssistanceRequests.customerId, customerId))).limit(1);
    if (!row) return null;
    const applicants = await this.connection.db.select().from(visaAssistanceRequestTravellers).where(eq(visaAssistanceRequestTravellers.requestId, id)).orderBy(asc(visaAssistanceRequestTravellers.createdAt));
    const files = await this.connection.db.select({ link: visaAssistanceRequestDocuments, doc: documents, version: documentVersions }).from(visaAssistanceRequestDocuments)
      .innerJoin(documents, and(eq(documents.id, visaAssistanceRequestDocuments.documentId), eq(documents.customerId, customerId)))
      .innerJoin(documentVersions, and(eq(documentVersions.id, visaAssistanceRequestDocuments.documentVersionId), eq(documentVersions.documentId, documents.id)))
      .where(eq(visaAssistanceRequestDocuments.requestId, id));
    return { ...row, status: row.status as VisaAssistanceRequestSummary['status'], createdAt: row.createdAt.toISOString(),
      applicants: applicants.map(a => ({ travellerId: a.travellerId, details: a.applicantDetails as unknown as VisaAssistanceApplicantInput | null })),
      documents: files.map(({ link, doc, version }) => ({ id: link.id, travellerId: link.travellerId, documentId: doc.id, documentVersionId: version.id, filename: version.originalFilename, fileSize: version.fileSize, documentType: doc.documentType as VisaAssistanceRequestDetail['documents'][number]['documentType'], scanStatus: version.securityScanStatus })) };
  }
  async assistanceAction(customerId: string, id: string, action: 'LINK' | 'UNLINK' | 'SUBMIT' | 'NOTE', input: { travellerId?: string; documentId?: string; documentVersionId?: string; linkId?: string; customerMessage?: string } = {}): Promise<VisaAssistanceRequestDetail | null> {
    if (input.customerMessage !== undefined && (typeof input.customerMessage !== 'string' || input.customerMessage.length > 2000)) throw new VisaValidationError('Notes must be at most 2,000 characters');
    if (action === 'NOTE' && input.customerMessage === undefined) throw new VisaValidationError('Provide a note to save');
    const found = await this.connection.db.transaction(async tx => {
      const [request] = await tx.select().from(visaAssistanceRequests).where(and(eq(visaAssistanceRequests.id, id), eq(visaAssistanceRequests.customerId, customerId))).for('update');
      if (!request) return false;
      if (action === 'SUBMIT' && request.status === 'IN_REVIEW') return true;
      if (request.status !== 'NEW') throw new VisaConflictError('This request has already been submitted');
      if (action === 'LINK') {
        const [applicant] = await tx.select().from(visaAssistanceRequestTravellers).where(and(eq(visaAssistanceRequestTravellers.requestId, id), eq(visaAssistanceRequestTravellers.travellerId, input.travellerId!)));
        const [file] = await tx.select({ version: documentVersions }).from(documents).innerJoin(documentVersions, eq(documentVersions.documentId, documents.id))
          .where(and(eq(documents.id, input.documentId!), eq(documents.customerId, customerId), eq(documents.travellerId, input.travellerId!), isNull(documents.archivedAt), eq(documentVersions.id, input.documentVersionId!), eq(documentVersions.uploadState, 'UPLOADED')));
        if (!applicant || !file || file.version.securityScanStatus === 'FAILED') throw new VisaValidationError('Choose an uploaded document belonging to this applicant');
        await tx.insert(visaAssistanceRequestDocuments).values({ requestId: id, travellerId: input.travellerId!, documentId: input.documentId!, documentVersionId: input.documentVersionId! }).onConflictDoNothing();
      } else if (action === 'NOTE') {
        await tx.update(visaAssistanceRequests).set({ customerMessage: input.customerMessage!.trim() || null, updatedAt: new Date() }).where(eq(visaAssistanceRequests.id, id));
      } else if (action === 'UNLINK') {
        await tx.delete(visaAssistanceRequestDocuments).where(and(eq(visaAssistanceRequestDocuments.requestId, id), eq(visaAssistanceRequestDocuments.id, input.linkId!)));
      } else {
        const [paid] = await tx.select({id:orders.id}).from(orders).innerJoin(orderItems, eq(orderItems.orderId, orders.id)).innerJoin(payments, eq(payments.orderId, orders.id)).where(and(eq(orderItems.referenceId, id), eq(orderItems.itemType, 'VISA_SERVICE'), eq(orders.customerId, customerId), isNull(orders.bookingIntentId), isNull(orders.visaApplicationId), eq(orders.status, 'PAID'), eq(payments.customerId, customerId), eq(payments.status, 'SUCCEEDED'), eq(payments.amount, orders.totalAmount), eq(payments.currency, orders.currency), isNotNull(orders.paidAt), isNotNull(payments.paidAt))).limit(1);
        if (!paid) throw new VisaValidationError('Complete payment before submitting your visa request');
        const people = await tx.select().from(visaAssistanceRequestTravellers).where(eq(visaAssistanceRequestTravellers.requestId, id));
        if (!people.length || people.some(p => !p.applicantDetails)) throw new VisaValidationError('Complete the applicant form before submitting');
        const files = await tx.select({ doc: documents, version: documentVersions }).from(visaAssistanceRequestDocuments)
          .innerJoin(documents, eq(documents.id, visaAssistanceRequestDocuments.documentId)).innerJoin(documentVersions, eq(documentVersions.id, visaAssistanceRequestDocuments.documentVersionId))
          .where(eq(visaAssistanceRequestDocuments.requestId, id));
        if (files.some(f => f.doc.archivedAt || f.version.uploadState !== 'UPLOADED' || f.version.securityScanStatus === 'FAILED')) throw new VisaValidationError('Remove unavailable documents before submitting');
        await tx.update(visaAssistanceRequests).set({ status: 'IN_REVIEW', updatedAt: new Date(), ...(input.customerMessage !== undefined ? {customerMessage: input.customerMessage.trim() || null} : {}) }).where(eq(visaAssistanceRequests.id, id));
      }
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: request.tripId, event: 'visa.assistance.' + action.toLowerCase() });
      return true;
    });
    return found ? this.assistanceDetail(customerId, id) : null;
  }
  async catalogue(countryCode: string): Promise<VisaType[]> {
    const rows = await this.connection.db.select({ type: visaTypes, version: visaServiceVersions }).from(visaTypes)
      .innerJoin(visaServiceVersions, eq(visaServiceVersions.visaTypeId, visaTypes.id))
      .where(and(eq(visaTypes.active, true), eq(visaServiceVersions.active, true),
        eq(visaTypes.destinationCountryCode, countryCode),
        or(isNull(visaServiceVersions.effectiveFrom), lte(visaServiceVersions.effectiveFrom, today())),
        or(isNull(visaServiceVersions.effectiveUntil), gte(visaServiceVersions.effectiveUntil, today()))))
      .orderBy(asc(visaTypes.name), desc(visaServiceVersions.version));
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) if (!latest.has(row.type.id)) latest.set(row.type.id, row);
    return [...latest.values()].map(({ type, version }) => ({ id: type.id, destinationCountryCode: type.destinationCountryCode,
      code: type.code, name: type.name, description: type.description, version: version.version,
      processingTimeText: version.processingTimeText, governmentFeeAmount: version.governmentFeeAmount,
      serviceFeeAmount: version.serviceFeeAmount, currency: version.currency, validityText: version.validityText,
      entryType: version.entryType, nationalityEligibility: version.nationalityEligibility,
      otherFeeComponents: version.otherFeeComponents, notes: version.notes, disclaimers: version.disclaimers }));
  }
  async types(customerId: string, tripId: string): Promise<VisaType[] | null> {
    const [trip] = await this.connection.db.select({ id: trips.id }).from(trips).where(and(eq(trips.id, tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).limit(1);
    if (!trip) return null;
    const destinations = await this.connection.db.select({ code: tripDestinations.countryCode }).from(tripDestinations).where(eq(tripDestinations.tripId, tripId));
    if (!destinations.length) return [];
    const rows = await this.connection.db.select({ type: visaTypes, version: visaServiceVersions }).from(visaTypes)
      .innerJoin(visaServiceVersions, eq(visaServiceVersions.visaTypeId, visaTypes.id))
      .where(and(eq(visaTypes.active, true), eq(visaServiceVersions.active, true),
        or(isNull(visaServiceVersions.effectiveFrom), lte(visaServiceVersions.effectiveFrom, today())),
        or(isNull(visaServiceVersions.effectiveUntil), gte(visaServiceVersions.effectiveUntil, today())),
        inArray(visaTypes.destinationCountryCode, destinations.map((item) => item.code))))
      .orderBy(asc(visaTypes.name), desc(visaServiceVersions.version));
    const latest = new Map<string, typeof rows[number]>();
    for (const row of rows) if (!latest.has(row.type.id)) latest.set(row.type.id, row);
    return [...latest.values()].map(({ type, version }) => ({ id: type.id, destinationCountryCode: type.destinationCountryCode,
      code: type.code, name: type.name, description: type.description, version: version.version,
      processingTimeText: version.processingTimeText, governmentFeeAmount: version.governmentFeeAmount,
      serviceFeeAmount: version.serviceFeeAmount, currency: version.currency, validityText: version.validityText,
      entryType: version.entryType, nationalityEligibility: version.nationalityEligibility,
      otherFeeComponents: version.otherFeeComponents, notes: version.notes, disclaimers: version.disclaimers }));
  }
  private async assembled(_customerId: string, rows: ApplicationRow[]): Promise<VisaApplicationDetail[]> {
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const [types, people, requirements, links, history, requests, customerUpdates, orderRows] = await Promise.all([
      this.connection.db.select().from(visaTypes).where(inArray(visaTypes.id, [...new Set(rows.map((row) => row.visaTypeId))])),
      this.connection.db.select().from(visaApplicationTravellers).where(inArray(visaApplicationTravellers.applicationId, ids)),
      this.connection.db.select().from(visaApplicationRequirements).where(inArray(visaApplicationRequirements.applicationId, ids)).orderBy(asc(visaApplicationRequirements.displayOrder)),
      this.connection.db.select({ applicationRequirementId: visaRequirementDocuments.applicationRequirementId, documentId: documents.id, documentVersionId: documentVersions.id, documentType: documents.documentType, displayName: documents.displayName, originalFilename: documentVersions.originalFilename, versionNumber: documentVersions.versionNumber, securityScanStatus: documentVersions.securityScanStatus, uploadState: documentVersions.uploadState })
        .from(visaRequirementDocuments).innerJoin(visaApplicationRequirements, eq(visaRequirementDocuments.applicationRequirementId, visaApplicationRequirements.id))
        .innerJoin(documents, eq(visaRequirementDocuments.documentId, documents.id))
        .innerJoin(documentVersions, eq(visaRequirementDocuments.documentVersionId, documentVersions.id))
        .where(inArray(visaApplicationRequirements.applicationId, ids)),
      this.connection.db.select().from(visaStatusHistory).where(inArray(visaStatusHistory.applicationId, ids)).orderBy(asc(visaStatusHistory.createdAt)),
      this.connection.db.select().from(visaReviewRequests).where(inArray(visaReviewRequests.applicationId, ids)).orderBy(desc(visaReviewRequests.createdAt)),
      this.connection.db.select({ id: visaApplicationNotes.id, applicationId: visaApplicationNotes.applicationId, note: visaApplicationNotes.note, createdAt: visaApplicationNotes.createdAt })
        .from(visaApplicationNotes).where(and(inArray(visaApplicationNotes.applicationId, ids), eq(visaApplicationNotes.visibility, 'CUSTOMER')))
        .orderBy(asc(visaApplicationNotes.createdAt)),
      this.connection.db.select({ applicationId: orders.visaApplicationId, id: orders.id, paymentStatus: payments.status })
        .from(orders).leftJoin(payments, eq(payments.orderId, orders.id)).where(inArray(orders.visaApplicationId, ids)),
    ]);
    const names = new Map(types.map((item) => [item.id, item.name]));
    return rows.map((row) => {
      const ownRequirements = requirements.filter((item) => item.applicationId === row.id);
      const mapped: VisaApplicationRequirement[] = ownRequirements.map((item) => ({ id: item.id, travellerId: item.travellerId, requirementCode: item.requirementCode, name: item.nameSnapshot, description: item.descriptionSnapshot, required: item.requiredSnapshot, documentType: item.documentTypeSnapshot as VisaApplicationRequirement['documentType'], status: item.status as VisaApplicationRequirement['status'], displayOrder: item.displayOrder, conditionSnapshot: item.conditionSnapshot, documents: links.filter((link) => link.applicationRequirementId === item.id).map((link): VisaRequirementDocument => ({ documentId: link.documentId, documentVersionId: link.documentVersionId, documentType: link.documentType as VisaRequirementDocument['documentType'], displayName: link.displayName, originalFilename: link.originalFilename, versionNumber: link.versionNumber, securityScanStatus: link.securityScanStatus as VisaRequirementDocument['securityScanStatus'], uploadState: link.uploadState as VisaRequirementDocument['uploadState'] })) }));
      const answerSnapshot = row.answers as Record<string, Record<string, unknown>>;
      const required = mapped.filter((item) => item.required && item.status !== 'NOT_APPLICABLE' &&
        conditionMatches(item.conditionSnapshot, { ...(answerSnapshot.application ?? {}), ...(answerSnapshot[item.travellerId] ?? {}) }));
      const timelineLabels: Partial<Record<VisaApplicationStatus, string>> = {
        DRAFT: 'Draft started', INCOMPLETE: 'Application needs details', SUBMITTED: 'Application submitted',
        AWAITING_PAYMENT: 'Payment required', PAYMENT_CONFIRMING: 'Payment confirming', PAYMENT_FAILED: 'Payment failed',
        PAID: 'Payment received', DOCUMENT_REVIEW: 'Documents under review', ADDITIONAL_DOCUMENTS_REQUIRED: 'Documents need attention',
        APPLICATION_PREPARATION: 'Application preparation', READY_FOR_SUBMISSION_TO_AUTHORITY: 'Ready for authority submission',
        SUBMITTED_TO_EMBASSY_OR_AUTHORITY: 'Submitted for processing', UNDER_PROCESSING: 'Under processing',
        ADDITIONAL_INFORMATION_REQUIRED: 'Additional information requested', APPROVED: 'Approved', VISA_ISSUED: 'Visa issued',
        REJECTED: 'Decision received', COMPLETED: 'Completed', CANCELLED: 'Application cancelled', DOCUMENTS_SUBMITTED: 'Documents submitted',
      };
      const ownHistory = history.filter((item) => item.applicationId === row.id);
      const ownRequests = requests.filter((item) => item.applicationId === row.id);
      const linkedOrder = orderRows.find((item) => item.applicationId === row.id);
      const formSnapshot = parseVisaFormDefinition(row.formSnapshot) as VisaFormDefinition;
      const feeSnapshot = row.feeSnapshot as VisaApplicationDetail['feeSnapshot'];
      const timeline: VisaTimelineItem[] = ownHistory.map((item) => ({ id: item.id, status: item.toStatus as VisaApplicationStatus,
        label: timelineLabels[item.toStatus as VisaApplicationStatus] ?? 'Status updated', customerMessage: item.customerMessage,
        createdAt: item.createdAt.toISOString() }));
      const reviewRequests: VisaReviewRequest[] = ownRequests.map((item) => ({ id: item.id, requirementId: item.applicationRequirementId,
        travellerId: item.travellerId, fieldKey: item.fieldKey, requestType: item.requestType as VisaReviewRequest['requestType'],
        reason: item.reason, dueAt: item.dueAt?.toISOString() ?? null, status: item.status as VisaReviewRequest['status'], createdAt: item.createdAt.toISOString() }));
      return { id: row.id, applicationReference: row.applicationReference, tripId: row.tripId, visaTypeId: row.visaTypeId,
        visaTypeName: names.get(row.visaTypeId) ?? 'Visa service', destinationCountryCode: row.destinationCountryCode,
        status: row.status as VisaApplicationStatus, travellerIds: people.filter((item) => item.applicationId === row.id).map((item) => item.travellerId),
        requiredCompleted: required.filter((item) => item.status === 'ACCEPTED' || links.some((link) => link.applicationRequirementId === item.id &&
          link.securityScanStatus === 'CLEAN' && link.uploadState === 'UPLOADED')).length,
        requiredTotal: required.length, requirements: mapped, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
        serviceSnapshot: row.serviceSnapshot, formSnapshot, answers: answerSnapshot,
        feeSnapshot, declarationVersion: row.declarationVersion, declarationAcceptedAt: row.declarationAcceptedAt?.toISOString() ?? null,
        timeline, reviewRequests, orderId: linkedOrder?.id ?? null,
        customerUpdates: customerUpdates.filter((item) => item.applicationId === row.id).map((item) => ({ id: item.id, message: item.note, createdAt: item.createdAt.toISOString() })),
        paymentStatus: (linkedOrder?.paymentStatus as VisaApplicationDetail['paymentStatus']) ?? null };
    });
  }
  async list(customerId: string, tripId?: string): Promise<VisaApplicationSummary[]> {
    const conditions = [eq(visaApplications.customerId, customerId), isNull(visaApplications.archivedAt)];
    if (tripId) conditions.push(eq(visaApplications.tripId, tripId));
    const rows = await this.connection.db.select().from(visaApplications).where(and(...conditions)).orderBy(asc(visaApplications.createdAt));
    return (await this.assembled(customerId, rows)).map((item): VisaApplicationSummary => ({
      id: item.id, applicationReference: item.applicationReference, tripId: item.tripId, visaTypeId: item.visaTypeId,
      visaTypeName: item.visaTypeName, destinationCountryCode: item.destinationCountryCode, status: item.status,
      travellerIds: item.travellerIds, requiredCompleted: item.requiredCompleted, requiredTotal: item.requiredTotal,
      createdAt: item.createdAt, updatedAt: item.updatedAt, paymentStatus: item.paymentStatus, feeSnapshot: item.feeSnapshot,
    }));
  }
  async detail(customerId: string, applicationId: string): Promise<VisaApplicationDetail | null> {
    const [row] = await this.connection.db.select().from(visaApplications).where(and(eq(visaApplications.id, applicationId), eq(visaApplications.customerId, customerId), isNull(visaApplications.archivedAt))).limit(1);
    return row ? (await this.assembled(customerId, [row]))[0]! : null;
  }
  async create(customerId: string, tripId: string, visaTypeId: string, travellerIds: string[]): Promise<VisaApplicationDetail | null> {
    if (!travellerIds.length || new Set(travellerIds).size !== travellerIds.length) throw new VisaValidationError('Choose at least one unique traveller');
    const applicationId = await this.connection.db.transaction(async (tx) => {
      const [trip] = await tx.select({ id: trips.id }).from(trips).where(and(eq(trips.id, tripId), eq(trips.customerId, customerId), isNull(trips.archivedAt))).limit(1);
      if (!trip) return null;
      const [type] = await tx.select().from(visaTypes).where(and(eq(visaTypes.id, visaTypeId), eq(visaTypes.active, true))).limit(1);
      if (!type) throw new VisaValidationError('This visa service is unavailable');
      const [serviceVersion] = await tx.select().from(visaServiceVersions).where(and(eq(visaServiceVersions.visaTypeId, visaTypeId), eq(visaServiceVersions.active, true),
        or(isNull(visaServiceVersions.effectiveFrom), lte(visaServiceVersions.effectiveFrom, today())),
        or(isNull(visaServiceVersions.effectiveUntil), gte(visaServiceVersions.effectiveUntil, today()))))
        .orderBy(desc(visaServiceVersions.version)).limit(1);
      if (!serviceVersion) throw new VisaValidationError('This visa service has not been configured for applications');
      const formSnapshot = parseVisaFormDefinition(serviceVersion.formDefinition);
      const feeSnapshot: NonNullable<VisaApplicationDetail['feeSnapshot']> = [];
      if (serviceVersion.governmentFeeAmount !== null) {
        if (!serviceVersion.currency) throw new VisaValidationError('Visa service fees are missing a currency');
        feeSnapshot.push({ code: 'GOVERNMENT_FEE', label: 'Government / embassy fee', amount: serviceVersion.governmentFeeAmount, currency: serviceVersion.currency });
      }
      if (serviceVersion.serviceFeeAmount !== null) {
        if (!serviceVersion.currency) throw new VisaValidationError('Visa service fees are missing a currency');
        feeSnapshot.push({ code: 'SERVICE_FEE', label: 'Seri Mechan service fee', amount: serviceVersion.serviceFeeAmount, currency: serviceVersion.currency });
      }
      for (const fee of serviceVersion.otherFeeComponents) {
        if (!fee || !fee.code || !fee.label || !/^\d+(?:\.\d{1,2})?$/.test(fee.amount) || !/^[A-Z]{3}$/.test(serviceVersion.currency ?? '')) {
          throw new VisaValidationError('The visa service contains an invalid fee');
        }
        feeSnapshot.push({ ...fee, currency: serviceVersion.currency! });
      }
      const [destination] = await tx.select({ id: tripDestinations.id }).from(tripDestinations).where(and(eq(tripDestinations.tripId, tripId), eq(tripDestinations.countryCode, type.destinationCountryCode))).limit(1);
      if (!destination) throw new VisaValidationError('This visa service does not match the trip');
      const people = await tx.select({ traveller: travellers }).from(tripTravellers)
        .innerJoin(customerTravellers, and(eq(customerTravellers.travellerId, tripTravellers.travellerId), eq(customerTravellers.customerId, customerId)))
        .innerJoin(travellers, eq(travellers.id, tripTravellers.travellerId))
        .where(and(eq(tripTravellers.tripId, tripId), inArray(tripTravellers.travellerId, travellerIds), isNull(travellers.archivedAt)));
      if (people.length !== travellerIds.length) throw new VisaValidationError('Every applicant must be a saved traveller on this trip');
      if (serviceVersion.nationalityEligibility.length && people.some(({ traveller }) => !traveller.nationalityCountryCode ||
        !serviceVersion.nationalityEligibility.includes(traveller.nationalityCountryCode))) {
        throw new VisaValidationError('One or more selected travellers do not meet this service nationality eligibility');
      }
      const now = today();
      const definitions = await tx.select().from(visaRequirements).where(and(eq(visaRequirements.visaTypeId, visaTypeId), eq(visaRequirements.active, true), or(isNull(visaRequirements.effectiveFrom), lte(visaRequirements.effectiveFrom, now)), or(isNull(visaRequirements.effectiveUntil), gte(visaRequirements.effectiveUntil, now)))).orderBy(asc(visaRequirements.displayOrder));
      const snapshots = people.flatMap(({ traveller }) => definitions.filter((rule) => applicable(rule, traveller, now)).map((rule) => ({ travellerId: traveller.id,
        sourceRequirementId: rule.id, requirementCode: rule.requirementCode, nameSnapshot: rule.name, descriptionSnapshot: rule.description,
        requiredSnapshot: rule.required, documentTypeSnapshot: rule.documentTypeRequired,
        conditionSnapshot: [...rule.conditions, ...(rule.residenceCountryCode ? [{ field: 'residence_country', operator: 'EQ' as const, value: rule.residenceCountryCode }] : []),
          ...(rule.applicantCategory ? [{ field: 'applicant_category', operator: 'EQ' as const, value: rule.applicantCategory }] : [])],
        displayOrder: rule.displayOrder, status: 'MISSING' })));
      const serviceSnapshot = { visaTypeId: type.id, code: type.code, name: type.name, destinationCountryCode: type.destinationCountryCode,
        description: type.description, version: serviceVersion.version, nationalityEligibility: serviceVersion.nationalityEligibility,
        processingTimeText: serviceVersion.processingTimeText, currency: serviceVersion.currency, validityText: serviceVersion.validityText,
        entryType: serviceVersion.entryType, notes: serviceVersion.notes, disclaimers: serviceVersion.disclaimers,
        effectiveFrom: serviceVersion.effectiveFrom, effectiveUntil: serviceVersion.effectiveUntil };
      const fieldKeys = new Set(formSnapshot.sections.flatMap((section) => section.fields.map((field) => field.key)));
      const initialAnswers: Record<string, Record<string, unknown>> = {};
      for (const { traveller } of people) {
        const known: Record<string, unknown> = {
          first_name: traveller.legalFirstName, given_name: traveller.legalFirstName, given_names: traveller.legalFirstName,
          legal_first_name: traveller.legalFirstName, middle_name: traveller.legalMiddleName, middle_names: traveller.legalMiddleName,
          surname: traveller.legalLastName, last_name: traveller.legalLastName, legal_last_name: traveller.legalLastName,
          date_of_birth: traveller.dateOfBirth, birth_date: traveller.dateOfBirth, gender: traveller.gender,
          nationality: traveller.nationalityCountryCode, nationality_country: traveller.nationalityCountryCode,
          nationality_country_code: traveller.nationalityCountryCode,
        };
        initialAnswers[traveller.id] = Object.fromEntries(Object.entries(known).filter(([key, value]) => fieldKeys.has(key) && value !== null));
      }
      const [customer] = await tx.select({ displayName: customers.displayName, phoneCountryCode: customers.phoneCountryCode, phoneNumber: customers.phoneNumber })
        .from(customers).where(eq(customers.id, customerId)).limit(1);
      const contact: Record<string, unknown> = { contact_name: customer?.displayName,
        contact_phone: `${customer?.phoneCountryCode ?? ''}${customer?.phoneNumber ?? ''}` || undefined,
        mobile_phone: `${customer?.phoneCountryCode ?? ''}${customer?.phoneNumber ?? ''}` || undefined };
      initialAnswers.application = Object.fromEntries(Object.entries(contact).filter(([key, value]) => fieldKeys.has(key) && value));
      const [application] = await tx.insert(visaApplications).values({ customerId, tripId, visaTypeId, serviceVersionId: serviceVersion.id,
        destinationCountryCode: type.destinationCountryCode, serviceSnapshot, formSnapshot: formSnapshot as unknown as Record<string, unknown>, feeSnapshot, answers: initialAnswers }).returning({ id: visaApplications.id });
      await tx.insert(visaApplicationTravellers).values(travellerIds.map((travellerId) => ({ applicationId: application!.id, travellerId })));
      if (snapshots.length) await tx.insert(visaApplicationRequirements).values(snapshots.map((item) => ({ ...item, applicationId: application!.id })));
      await tx.insert(visaStatusHistory).values({ applicationId: application!.id, fromStatus: null, toStatus: 'DRAFT', actorType: 'CUSTOMER', actorCustomerId: customerId });
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId, visaApplicationId: application!.id, event: 'visa.application.created' });
      return application!.id;
    });
    return applicationId ? this.detail(customerId, applicationId) : null;
  }
  async action(customerId: string, applicationId: string, action: 'MARK_INCOMPLETE' | 'SUBMIT_DOCUMENTS'): Promise<VisaApplicationDetail | null> {
    const found = await this.connection.db.transaction(async (tx) => {
      const [application] = await tx.select().from(visaApplications).where(and(eq(visaApplications.id, applicationId), eq(visaApplications.customerId, customerId), isNull(visaApplications.archivedAt))).limit(1);
      if (!application) return false;
      let next: VisaApplicationStatus;
      if (action === 'MARK_INCOMPLETE' && application.status === 'DRAFT') next = 'INCOMPLETE';
      else if (action === 'SUBMIT_DOCUMENTS' && ['DRAFT', 'INCOMPLETE'].includes(application.status)) {
        const required = await tx.select().from(visaApplicationRequirements).where(and(eq(visaApplicationRequirements.applicationId, applicationId), eq(visaApplicationRequirements.requiredSnapshot, true)));
        if (!required.length) throw new VisaValidationError('Visa requirements are not configured');
        const links = await tx.select({ requirementId: visaRequirementDocuments.applicationRequirementId, scan: documentVersions.securityScanStatus }).from(visaRequirementDocuments)
          .innerJoin(documentVersions, eq(visaRequirementDocuments.documentVersionId, documentVersions.id))
          .where(inArray(visaRequirementDocuments.applicationRequirementId, required.map((item) => item.id)));
        if (required.some((item) => item.status === 'REJECTED' || !links.some((link) => link.requirementId === item.id && link.scan === 'CLEAN'))) throw new VisaValidationError('Required documents must be provided and security-checked before submission');
        next = 'DOCUMENTS_SUBMITTED';
      } else throw new VisaConflictError('Invalid visa status transition');
      await tx.update(visaApplications).set({ status: next, submittedAt: next === 'DOCUMENTS_SUBMITTED' ? new Date() : application.submittedAt, updatedAt: new Date() }).where(eq(visaApplications.id, applicationId));
      await tx.insert(visaStatusHistory).values({ applicationId, fromStatus: application.status, toStatus: next, actorType: 'CUSTOMER', actorCustomerId: customerId });
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: application.tripId, visaApplicationId: applicationId, event: 'visa.status.changed' });
      return true;
    });
    return found ? this.detail(customerId, applicationId) : null;
  }
  async saveAnswers(customerId: string, applicationId: string, scope: string, incoming: Record<string, unknown>): Promise<VisaApplicationDetail | null> {
    const found = await this.connection.db.transaction(async (tx) => {
      const [application] = await tx.select().from(visaApplications).where(and(eq(visaApplications.id, applicationId),
        eq(visaApplications.customerId, customerId), isNull(visaApplications.archivedAt))).for('update').limit(1);
      if (!application) return false;
      const draft = ['DRAFT', 'INCOMPLETE'].includes(application.status);
      const correction = ['ADDITIONAL_INFORMATION_REQUIRED', 'ADDITIONAL_DOCUMENTS_REQUIRED'].includes(application.status);
      if (!draft && !correction) throw new VisaConflictError('Submitted applications can only be corrected when staff requests a change');
      const people = await tx.select({ travellerId: visaApplicationTravellers.travellerId }).from(visaApplicationTravellers)
        .where(eq(visaApplicationTravellers.applicationId, applicationId));
      const travellerIds = people.map((item) => item.travellerId);
      if (scope !== 'application' && !travellerIds.includes(scope)) throw new VisaValidationError('Choose an applicant on this application');
      if (JSON.stringify(incoming).length > 32_000) throw new VisaValidationError('The answer section is too large');
      if (correction) {
        const open = await tx.select({ fieldKey: visaReviewRequests.fieldKey, travellerId: visaReviewRequests.travellerId })
          .from(visaReviewRequests).where(and(eq(visaReviewRequests.applicationId, applicationId), eq(visaReviewRequests.status, 'OPEN'),
            inArray(visaReviewRequests.requestType, ['ANSWER', 'ADDITIONAL_INFO'])));
        const permitted = new Set(open.filter((item) => item.fieldKey && (!item.travellerId || item.travellerId === scope))
          .map((item) => item.fieldKey!));
        if (Object.keys(incoming).some((key) => !permitted.has(key))) throw new VisaConflictError('Only the answer requested by staff can be changed');
      }
      const form = parseVisaFormDefinition(application.formSnapshot);
      const existing = application.answers as Record<string, Record<string, unknown>>;
      const answers = { ...existing, [scope]: { ...(existing[scope] ?? {}), ...incoming } };
      validateVisaAnswers(form, answers, travellerIds, false);
      await tx.update(visaApplications).set({ answers, updatedAt: new Date() }).where(eq(visaApplications.id, applicationId));
      if (correction) {
        for (const key of Object.keys(incoming)) await tx.update(visaReviewRequests).set({ status: 'RESOLVED', resolvedAt: new Date() })
          .where(and(eq(visaReviewRequests.applicationId, applicationId), eq(visaReviewRequests.fieldKey, key),
            eq(visaReviewRequests.status, 'OPEN'), scope === 'application' ? isNull(visaReviewRequests.travellerId) : eq(visaReviewRequests.travellerId, scope)));
        const remaining = await tx.select({ requestType: visaReviewRequests.requestType }).from(visaReviewRequests)
          .where(and(eq(visaReviewRequests.applicationId, applicationId), eq(visaReviewRequests.status, 'OPEN')));
        const nextStatus: VisaApplicationStatus | null = !remaining.length ? 'DOCUMENT_REVIEW'
          : remaining.some((item) => item.requestType === 'DOCUMENT') ? 'ADDITIONAL_DOCUMENTS_REQUIRED'
            : 'ADDITIONAL_INFORMATION_REQUIRED';
        if (nextStatus && application.status !== nextStatus) {
          await tx.update(visaApplications).set({ status: nextStatus, updatedAt: new Date() }).where(eq(visaApplications.id, applicationId));
          await tx.insert(visaStatusHistory).values({ applicationId, fromStatus: application.status, toStatus: nextStatus,
            actorType: 'CUSTOMER', actorCustomerId: customerId, reasonCode: 'CUSTOMER_CORRECTION_SUBMITTED' });
          await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: application.tripId, visaApplicationId: applicationId, event: 'visa.status.changed' });
        }
      }
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: application.tripId,
        visaApplicationId: applicationId, event: 'visa.answer.updated' });
      return true;
    });
    return found ? this.detail(customerId, applicationId) : null;
  }

  async submit(customerId: string, applicationId: string, declarationVersion: string): Promise<VisaApplicationDetail | null> {
    const found = await this.connection.db.transaction(async (tx) => {
      const [application] = await tx.select().from(visaApplications).where(and(eq(visaApplications.id, applicationId),
        eq(visaApplications.customerId, customerId), isNull(visaApplications.archivedAt))).for('update').limit(1);
      if (!application) return false;
      if (!['DRAFT', 'INCOMPLETE'].includes(application.status)) {
        if (application.status === 'SUBMITTED' || application.status === 'AWAITING_PAYMENT' || application.status === 'PAYMENT_CONFIRMING' || application.status === 'PAID' || application.status === 'DOCUMENT_REVIEW') return true;
        throw new VisaConflictError('This application cannot be submitted in its current status');
      }
      if (declarationVersion !== 'FLYSERI_VISA_DECLARATION_V1') throw new VisaValidationError('Please accept the current visa service declaration');
      const people = await tx.select({ travellerId: visaApplicationTravellers.travellerId }).from(visaApplicationTravellers)
        .where(eq(visaApplicationTravellers.applicationId, applicationId));
      const travellerIds = people.map((item) => item.travellerId);
      const answers = application.answers as Record<string, Record<string, unknown>>;
      const form = parseVisaFormDefinition(application.formSnapshot);
      const missingAnswers = validateVisaAnswers(form, answers, travellerIds, true);
      if (missingAnswers.length) throw new VisaValidationError(`Complete required details before submitting: ${missingAnswers.slice(0, 8).join('; ')}`);
      const requirements = await tx.select().from(visaApplicationRequirements)
        .where(eq(visaApplicationRequirements.applicationId, applicationId));
      if (!requirements.length) throw new VisaValidationError('This visa service has no configured document requirements and cannot accept submissions yet');
      const applicableRequirements = requirements.filter((item) => {
        const scoped = { ...(answers.application ?? {}), ...(answers[item.travellerId] ?? {}) };
        return conditionMatches(item.conditionSnapshot, scoped);
      });
      const notApplicable = requirements.filter((item) => !applicableRequirements.some((match) => match.id === item.id));
      for (const item of notApplicable) await tx.update(visaApplicationRequirements).set({ status: 'NOT_APPLICABLE', updatedAt: new Date() }).where(eq(visaApplicationRequirements.id, item.id));
      const required = applicableRequirements.filter((item) => item.requiredSnapshot);
      if (required.length) {
        const links = await tx.select({ requirementId: visaRequirementDocuments.applicationRequirementId, scan: documentVersions.securityScanStatus,
          uploadState: documentVersions.uploadState, documentOwner: documents.customerId, documentTraveller: documents.travellerId })
          .from(visaRequirementDocuments).innerJoin(visaApplicationRequirements, eq(visaRequirementDocuments.applicationRequirementId, visaApplicationRequirements.id))
          .innerJoin(documentVersions, eq(visaRequirementDocuments.documentVersionId, documentVersions.id))
          .innerJoin(documents, eq(visaRequirementDocuments.documentId, documents.id))
          .where(inArray(visaRequirementDocuments.applicationRequirementId, required.map((item) => item.id)));
        const missingDocuments = required.filter((item) => item.status === 'REJECTED' || item.status === 'REPLACEMENT_REQUIRED' ||
          !links.some((link) => link.requirementId === item.id && link.scan === 'CLEAN' && link.uploadState === 'UPLOADED' &&
            link.documentOwner === customerId && (!link.documentTraveller || link.documentTraveller === item.travellerId)));
        if (missingDocuments.length) throw new VisaValidationError(`Required documents still need attention: ${missingDocuments.slice(0, 8).map((item) => item.nameSnapshot).join(', ')}. Files can only be submitted after the secure scanner confirms them.`);
      }
      const now = new Date();
      await tx.update(visaApplications).set({ status: 'SUBMITTED', submittedAt: now, declarationVersion,
        declarationAcceptedAt: now, updatedAt: now }).where(eq(visaApplications.id, applicationId));
      await tx.insert(visaStatusHistory).values({ applicationId, fromStatus: application.status, toStatus: 'SUBMITTED',
        actorType: 'CUSTOMER', actorCustomerId: customerId });
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: application.tripId,
        visaApplicationId: applicationId, event: 'visa.application.submitted' });
      return true;
    });
    return found ? this.detail(customerId, applicationId) : null;
  }
  async archive(customerId: string, applicationId: string): Promise<boolean> {
    return this.connection.db.transaction(async (tx) => {
      const [application] = await tx.select({ status: visaApplications.status, tripId: visaApplications.tripId }).from(visaApplications).where(and(eq(visaApplications.id, applicationId), eq(visaApplications.customerId, customerId), isNull(visaApplications.archivedAt))).limit(1);
      if (!application) return false;
      if (!['DRAFT', 'INCOMPLETE'].includes(application.status)) throw new VisaConflictError('Only a draft application can be archived');
      await tx.update(visaApplications).set({ status: 'CANCELLED', archivedAt: new Date(), updatedAt: new Date() }).where(eq(visaApplications.id, applicationId));
      await tx.insert(visaStatusHistory).values({ applicationId, fromStatus: application.status, toStatus: 'CANCELLED', actorType: 'CUSTOMER', actorCustomerId: customerId });
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: application.tripId, visaApplicationId: applicationId, event: 'visa.application.archived' });
      return true;
    });
  }
  async link(customerId: string, applicationId: string, requirementId: string, documentId: string, versionId: string): Promise<VisaApplicationDetail | null> {
    const found = await this.connection.db.transaction(async (tx) => {
      const [application] = await tx.select({ id: visaApplications.id, tripId: visaApplications.tripId, status: visaApplications.status }).from(visaApplications).where(and(eq(visaApplications.id, applicationId), eq(visaApplications.customerId, customerId), isNull(visaApplications.archivedAt))).limit(1);
      if (!application) return false;
      const draft = ['DRAFT', 'INCOMPLETE'].includes(application.status);
      const replacement = ['ADDITIONAL_DOCUMENTS_REQUIRED', 'ADDITIONAL_INFORMATION_REQUIRED'].includes(application.status);
      if (!draft && !replacement) throw new VisaConflictError('This application cannot be edited');
      const [requirement] = await tx.select().from(visaApplicationRequirements).where(and(eq(visaApplicationRequirements.id, requirementId), eq(visaApplicationRequirements.applicationId, applicationId))).limit(1);
      if (!requirement) throw new VisaValidationError('Requirement unavailable');
      if (replacement) {
        const [openRequest] = await tx.select({ id: visaReviewRequests.id }).from(visaReviewRequests)
          .where(and(eq(visaReviewRequests.applicationId, applicationId), eq(visaReviewRequests.applicationRequirementId, requirementId),
            eq(visaReviewRequests.status, 'OPEN'), inArray(visaReviewRequests.requestType, ['DOCUMENT', 'ADDITIONAL_INFO']))).limit(1);
        if (!openRequest) throw new VisaConflictError('Staff has not requested a change to this document');
      }
      const [file] = await tx.select({ travellerId: documents.travellerId, type: documents.documentType }).from(documents).where(and(eq(documents.id, documentId), eq(documents.customerId, customerId), isNull(documents.archivedAt))).limit(1);
      if (!file) throw new VisaValidationError('Document unavailable');
      if (file.travellerId && file.travellerId !== requirement.travellerId) throw new VisaValidationError('Document belongs to another traveller');
      if (!file.travellerId && ['PASSPORT', 'NATIONAL_ID', 'PASSPORT_PHOTO', 'RESIDENCE_PERMIT', 'BIRTH_CERTIFICATE', 'PREVIOUS_VISA', 'TRAVEL_DOCUMENT'].includes(file.type)) throw new VisaValidationError('Assign this document to the applicant first');
      if (requirement.documentTypeSnapshot && file.type !== requirement.documentTypeSnapshot) throw new VisaValidationError('Choose the requested document type');
      const [version] = await tx.select({ id: documentVersions.id }).from(documentVersions).where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId), eq(documentVersions.uploadState, 'UPLOADED'))).limit(1);
      if (!version) throw new VisaValidationError('Document file unavailable');
      const [existing] = await tx.select({ id: visaRequirementDocuments.id }).from(visaRequirementDocuments).where(and(eq(visaRequirementDocuments.applicationRequirementId, requirementId), eq(visaRequirementDocuments.documentVersionId, versionId))).limit(1);
      if (existing) throw new VisaConflictError('Document already linked');
      await tx.insert(visaRequirementDocuments).values({ applicationRequirementId: requirementId, documentId, documentVersionId: versionId });
      await tx.update(visaApplicationRequirements).set({ status: 'UPLOADED', updatedAt: new Date() }).where(eq(visaApplicationRequirements.id, requirementId));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: application.tripId, documentId, visaApplicationId: applicationId, event: 'visa.requirement.document.linked' });
      return true;
    });
    return found ? this.detail(customerId, applicationId) : null;
  }
  async unlink(customerId: string, applicationId: string, requirementId: string, documentId: string): Promise<VisaApplicationDetail | null> {
    const found = await this.connection.db.transaction(async (tx) => {
      const [application] = await tx.select({ id: visaApplications.id, tripId: visaApplications.tripId, status: visaApplications.status }).from(visaApplications).where(and(eq(visaApplications.id, applicationId), eq(visaApplications.customerId, customerId), isNull(visaApplications.archivedAt))).limit(1);
      if (!application) return false;
      if (!['DRAFT', 'INCOMPLETE'].includes(application.status)) throw new VisaConflictError('This application cannot be edited');
      const [requirement] = await tx.select({ id: visaApplicationRequirements.id }).from(visaApplicationRequirements).where(and(eq(visaApplicationRequirements.id, requirementId), eq(visaApplicationRequirements.applicationId, applicationId))).limit(1);
      if (!requirement) throw new VisaValidationError('Requirement unavailable');
      const removed = await tx.delete(visaRequirementDocuments).where(and(eq(visaRequirementDocuments.applicationRequirementId, requirementId), eq(visaRequirementDocuments.documentId, documentId))).returning({ id: visaRequirementDocuments.id });
      if (!removed.length) throw new VisaValidationError('Document link unavailable');
      const remaining = await tx.select({ id: visaRequirementDocuments.id }).from(visaRequirementDocuments).where(eq(visaRequirementDocuments.applicationRequirementId, requirementId)).limit(1);
      if (!remaining.length) await tx.update(visaApplicationRequirements).set({ status: 'MISSING', updatedAt: new Date() }).where(eq(visaApplicationRequirements.id, requirementId));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: application.tripId, documentId, visaApplicationId: applicationId, event: 'visa.requirement.document.unlinked' });
      return true;
    });
    return found ? this.detail(customerId, applicationId) : null;
  }
}
