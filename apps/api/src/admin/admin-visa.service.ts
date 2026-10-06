import { Inject, Injectable } from '@nestjs/common';
import { and, asc, desc, eq, inArray, isNull, or } from 'drizzle-orm';
import { adminAuditEvents, auditEvents, customers, documentVersions, documents, orders, payments, travellers, visaApplicationNotes, visaAssistanceRequestDocuments, visaAssistanceRequestTravellers, visaAssistanceRequests, visaAssistanceFeeSettings,
  visaApplicationRequirements, visaApplicationTravellers, visaApplications, visaRequirementDocuments, visaRequirements,
  visaReviewRequests, visaServiceVersions, visaStatusHistory, visaTypes, trips, type DatabaseConnection } from '@flyseri/database';
import type { VisaApplicationStatus, VisaAssistanceAdminRequest, VisaAssistanceAdminRequestDetail, VisaAssistanceApplicantInput } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { DATABASE_CONNECTION } from '../tokens.js';
import type { AdminIdentity, AdminRole } from './admin-auth.js';
import { conditionMatches, parseVisaFormDefinition } from '../visa/visa-form.js';
import { VisaConflictError, VisaValidationError } from '../visa/visa.errors.js';

export interface VisaServiceVersionInput {
  description?: string | null;
  processingTimeText?: string | null; governmentFeeAmount?: string | null;
  serviceFeeAmount?: string | null; otherFeeComponents?: Array<{ code: string; label: string; amount: string }>;
  currency?: string | null; validityText?: string | null; entryType?: string | null; notes?: string | null;
  disclaimers?: string[]; nationalityEligibility?: string[]; formDefinition: unknown;
  effectiveFrom?: string | null; effectiveUntil?: string | null;
  published: boolean;
}
export interface VisaRequirementInput {
  requirementCode: string; name: string; description?: string | null; documentTypeRequired?: string | null;
  required: boolean; displayOrder: number; nationalityCountryCode?: string | null; residenceCountryCode?: string | null;
  applicantCategory?: string | null; minAge?: number | null; maxAge?: number | null; effectiveFrom?: string | null;
  effectiveUntil?: string | null; conditions?: Array<{ field: string; operator: 'EQ' | 'NEQ' | 'IN'; value: string | string[] }>;
}
export type VisaStaffStatus = Exclude<VisaApplicationStatus, 'DRAFT' | 'INCOMPLETE' | 'READY_TO_SUBMIT' | 'AWAITING_PAYMENT' | 'PAYMENT_CONFIRMING' | 'PAYMENT_FAILED' | 'PAID' | 'DOCUMENTS_SUBMITTED'>;

const transitions: Partial<Record<VisaApplicationStatus, VisaApplicationStatus[]>> = {
  SUBMITTED: ['AWAITING_PAYMENT', 'CANCELLED'],
  PAID: ['DOCUMENT_REVIEW'],
  DOCUMENT_REVIEW: ['ADDITIONAL_DOCUMENTS_REQUIRED', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPLICATION_PREPARATION', 'REJECTED', 'CANCELLED'],
  ADDITIONAL_DOCUMENTS_REQUIRED: ['DOCUMENT_REVIEW', 'CANCELLED'],
  ADDITIONAL_INFORMATION_REQUIRED: ['DOCUMENT_REVIEW', 'CANCELLED'],
  APPLICATION_PREPARATION: ['READY_FOR_SUBMISSION_TO_AUTHORITY', 'REJECTED', 'CANCELLED'],
  READY_FOR_SUBMISSION_TO_AUTHORITY: ['SUBMITTED_TO_EMBASSY_OR_AUTHORITY', 'APPLICATION_PREPARATION'],
  SUBMITTED_TO_EMBASSY_OR_AUTHORITY: ['UNDER_PROCESSING'],
  UNDER_PROCESSING: ['ADDITIONAL_INFORMATION_REQUIRED', 'APPROVED', 'REJECTED'],
  APPROVED: ['VISA_ISSUED', 'COMPLETED'], VISA_ISSUED: ['COMPLETED'],
};
const audit = (db: DatabaseConnection['db'], staff: AdminIdentity, requestId: string, event: string, applicationId: string) =>
  db.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role, event, resourceType: 'visa_application', resourceId: applicationId, requestId });
const httpError = (error: unknown): never => {
  if (error instanceof VisaValidationError) throw new ApiException('VALIDATION_ERROR', error.message, 400);
  if (error instanceof VisaConflictError) throw new ApiException('CONFLICT', error.message, 409);
  throw error;
};

@Injectable()
export class AdminVisaService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined) {}
  private get db() { if (!this.connection) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Flyseri data is unavailable.', 503); return this.connection.db; }

  async assistanceFee() {
    const [fee] = await this.db.select().from(visaAssistanceFeeSettings).where(eq(visaAssistanceFeeSettings.id, 'default')).limit(1);
    return fee ? {amount:fee.amount,currency:fee.currency,basis:fee.basis,active:fee.active,updatedAt:fee.updatedAt.toISOString()} : null;
  }
  async saveAssistanceFee(input: {amount:string;currency:string;basis:string;active:boolean}, staff: AdminIdentity, requestId: string) {
    if (!/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/.test(input.amount) || Number(input.amount) <= 0 || !['MYR','USD','SGD','EUR','GBP','AUD'].includes(input.currency) || !['APPLICATION','APPLICANT'].includes(input.basis) || typeof input.active !== 'boolean') throw new ApiException('VALIDATION_ERROR', 'Enter a positive fee, supported currency and charging basis.', 400);
    await this.db.transaction(async tx => {
      await tx.insert(visaAssistanceFeeSettings).values({id:'default',...input,updatedAt:new Date()}).onConflictDoUpdate({target:visaAssistanceFeeSettings.id,set:{...input,updatedAt:new Date()}});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'visa.assistance.fee.updated',resourceType:'visa_fee_settings',resourceId:'00000000-0000-4000-8000-000000000025',requestId});
    });
    return this.assistanceFee();
  }
  async assistanceRequests(): Promise<VisaAssistanceAdminRequest[]> {
    const rows = await this.db.select({ request: visaAssistanceRequests, visaAssistanceFeeSettings, customerName: customers.displayName })
      .from(visaAssistanceRequests).innerJoin(customers, eq(visaAssistanceRequests.customerId, customers.id))
      .orderBy(desc(visaAssistanceRequests.createdAt)).limit(200);
    if (!rows.length) return [];
    const travellersByRequest = new Map<string, string[]>();
    const links = await this.db.select({ requestId: visaAssistanceRequestTravellers.requestId, travellerId: visaAssistanceRequestTravellers.travellerId })
      .from(visaAssistanceRequestTravellers).where(inArray(visaAssistanceRequestTravellers.requestId, rows.map(({ request }) => request.id)));
    for (const link of links) travellersByRequest.set(link.requestId, [...(travellersByRequest.get(link.requestId) ?? []), link.travellerId]);
    return rows.map(({ request, customerName }) => ({ id: request.id, requestReference: request.requestReference,
      tripId: request.tripId, destinationCountryCode: request.destinationCountryCode, expectedTravelDate: request.expectedTravelDate,
      purpose: request.purpose, status: request.status as VisaAssistanceAdminRequest['status'], createdAt: request.createdAt.toISOString(),
      customerId: request.customerId, customerName, contactName: request.contactName, contactEmail: request.contactEmail,
      contactPhone: request.contactPhone, customerMessage: request.customerMessage, travellerIds: travellersByRequest.get(request.id) ?? [] }));
  }
  async assistanceRequest(id: string, staff: AdminIdentity, requestId: string): Promise<VisaAssistanceAdminRequestDetail> {
    const [row] = await this.db.select({ request: visaAssistanceRequests, visaAssistanceFeeSettings, customerName: customers.displayName })
      .from(visaAssistanceRequests).innerJoin(customers, eq(visaAssistanceRequests.customerId, customers.id))
      .where(eq(visaAssistanceRequests.id, id)).limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Visa request not found.', 404);
    const links = await this.db.select({ travellerId: visaAssistanceRequestTravellers.travellerId,
      details: visaAssistanceRequestTravellers.applicantDetails })
      .from(visaAssistanceRequestTravellers).where(eq(visaAssistanceRequestTravellers.requestId, id))
      .orderBy(asc(visaAssistanceRequestTravellers.createdAt));
    await this.db.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role,
      event: 'visa.assistance.request.viewed', resourceType: 'visa_assistance_request', resourceId: id, requestId });
    const attachments = await this.db.select({ link: visaAssistanceRequestDocuments, doc: documents, version: documentVersions }).from(visaAssistanceRequestDocuments)
      .innerJoin(documents, eq(documents.id, visaAssistanceRequestDocuments.documentId))
      .innerJoin(documentVersions, and(eq(documentVersions.id, visaAssistanceRequestDocuments.documentVersionId), eq(documentVersions.documentId, documents.id)))
      .where(eq(visaAssistanceRequestDocuments.requestId, id));
    const { request, customerName } = row;
    return { id: request.id, requestReference: request.requestReference, tripId: request.tripId,
      destinationCountryCode: request.destinationCountryCode, expectedTravelDate: request.expectedTravelDate,
      expectedReturnDate: request.expectedReturnDate, purpose: request.purpose,
      accommodationOrHost: request.accommodationOrHost, status: request.status as VisaAssistanceAdminRequestDetail['status'],
      createdAt: request.createdAt.toISOString(), customerId: request.customerId, customerName,
      contactName: request.contactName, contactEmail: request.contactEmail, contactPhone: request.contactPhone,
      customerMessage: request.customerMessage, travellerIds: links.map(({ travellerId }) => travellerId),
      documents: attachments.map(({ link, doc, version }) => ({ id: link.id, travellerId: link.travellerId, documentId: doc.id, documentVersionId: version.id, filename: version.originalFilename, fileSize: version.fileSize, documentType: doc.documentType as VisaAssistanceAdminRequestDetail['documents'][number]['documentType'], scanStatus: version.securityScanStatus })),
      applicants: links.map(({ travellerId, details }) => ({ travellerId,
        details: details ? details as unknown as VisaAssistanceApplicantInput : null })) };
  }

  async createService(input: { destinationCountryCode: string; code: string; name: string; description?: string | null } & VisaServiceVersionInput,
    staff: AdminIdentity, requestId: string) {
    const form = parseVisaFormDefinition(input.formDefinition);
    this.validateVersion(input);
    const result = await this.db.transaction(async (tx) => {
      const [type] = await tx.insert(visaTypes).values({ destinationCountryCode: input.destinationCountryCode,
        code: input.code, name: input.name.trim(), description: input.description ?? null, active: input.published }).returning();
      if (!type) throw new Error('Visa service creation failed');
      const [version] = await tx.insert(visaServiceVersions).values({ visaTypeId: type.id, version: 1,
        active: input.published, nationalityEligibility: input.nationalityEligibility ?? [],
        processingTimeText: input.processingTimeText ?? null, governmentFeeAmount: input.governmentFeeAmount ?? null,
        serviceFeeAmount: input.serviceFeeAmount ?? null, otherFeeComponents: input.otherFeeComponents ?? [],
        currency: input.currency ?? null, validityText: input.validityText ?? null, entryType: input.entryType ?? null,
        notes: input.notes ?? null, disclaimers: input.disclaimers ?? [], formDefinition: form as unknown as Record<string, unknown>,
        effectiveFrom: input.effectiveFrom ?? null, effectiveUntil: input.effectiveUntil ?? null }).returning();
      if (!version) throw new Error('Visa service version creation failed');
      await tx.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role, event: 'visa.service.created',
        resourceType: 'visa_type', resourceId: type.id, requestId });
      return { ...type, version: version.version, published: version.active };
    });
    return result;
  }

  async createVersion(visaTypeId: string, input: VisaServiceVersionInput, staff: AdminIdentity, requestId: string) {
    const form = parseVisaFormDefinition(input.formDefinition);
    this.validateVersion(input);
    return this.db.transaction(async (tx) => {
      const [type] = await tx.select().from(visaTypes).where(eq(visaTypes.id, visaTypeId)).for('update').limit(1);
      if (!type) throw new ApiException('NOT_FOUND', 'Visa service not found.', 404);
      const versions = await tx.select({ version: visaServiceVersions.version }).from(visaServiceVersions).where(eq(visaServiceVersions.visaTypeId, visaTypeId));
      const versionNumber = Math.max(0, ...versions.map((item) => item.version)) + 1;
      const [version] = await tx.insert(visaServiceVersions).values({ visaTypeId, version: versionNumber, active: input.published,
        nationalityEligibility: input.nationalityEligibility ?? [], processingTimeText: input.processingTimeText ?? null,
        governmentFeeAmount: input.governmentFeeAmount ?? null, serviceFeeAmount: input.serviceFeeAmount ?? null,
        otherFeeComponents: input.otherFeeComponents ?? [], currency: input.currency ?? null, validityText: input.validityText ?? null,
        entryType: input.entryType ?? null, notes: input.notes ?? null, disclaimers: input.disclaimers ?? [],
        formDefinition: form as unknown as Record<string, unknown>, effectiveFrom: input.effectiveFrom ?? null,
        effectiveUntil: input.effectiveUntil ?? null }).returning();
      if (!version) throw new Error('Visa service version creation failed');
      await tx.update(visaTypes).set({ active: input.published, description: input.description ?? type.description, updatedAt: new Date() }).where(eq(visaTypes.id, visaTypeId));
      await tx.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role, event: 'visa.service.version_created',
        resourceType: 'visa_service_version', resourceId: version.id, requestId });
      return { id: version.id, visaTypeId, version: versionNumber, active: version.active };
    });
  }

  async addRequirement(visaTypeId: string, input: VisaRequirementInput, staff: AdminIdentity, requestId: string) {
    if ((input.minAge !== null && input.minAge !== undefined && (input.minAge < 0 || input.minAge > 125)) ||
        (input.maxAge !== null && input.maxAge !== undefined && (input.maxAge < 0 || input.maxAge > 125)) ||
        input.minAge !== null && input.minAge !== undefined && input.maxAge !== null && input.maxAge !== undefined && input.maxAge < input.minAge) {
      throw new ApiException('VALIDATION_ERROR', 'The visa requirement age range is invalid.', 400);
    }
    const conditions = input.conditions ?? [];
    if (conditions.length > 20 || conditions.some((condition) => !condition || !/^[a-z][a-z0-9_.-]{0,79}$/.test(condition.field) ||
        !['EQ', 'NEQ', 'IN'].includes(condition.operator) || !(typeof condition.value === 'string' || Array.isArray(condition.value) && condition.value.length <= 20 && condition.value.every((value) => typeof value === 'string')))) {
      throw new ApiException('VALIDATION_ERROR', 'The conditional requirement rules are invalid.', 400);
    }
    const [type] = await this.db.select({ id: visaTypes.id }).from(visaTypes).where(eq(visaTypes.id, visaTypeId)).limit(1);
    if (!type) throw new ApiException('NOT_FOUND', 'Visa service not found.', 404);
    const [row] = await this.db.insert(visaRequirements).values({ visaTypeId, requirementCode: input.requirementCode,
      name: input.name.trim(), description: input.description ?? null, documentTypeRequired: input.documentTypeRequired ?? null,
      required: input.required, displayOrder: input.displayOrder, active: true, nationalityCountryCode: input.nationalityCountryCode ?? null,
      residenceCountryCode: input.residenceCountryCode ?? null, applicantCategory: input.applicantCategory ?? null,
      minAge: input.minAge ?? null, maxAge: input.maxAge ?? null, effectiveFrom: input.effectiveFrom ?? null,
      effectiveUntil: input.effectiveUntil ?? null, conditions }).returning({ id: visaRequirements.id });
    await this.db.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role,
      event: 'visa.requirement.created', resourceType: 'visa_requirement', resourceId: row!.id, requestId });
    return { id: row!.id, visaTypeId, requirementCode: input.requirementCode };
  }

  private validateVersion(input: VisaServiceVersionInput) {
    const fees = [input.governmentFeeAmount, input.serviceFeeAmount, ...(input.otherFeeComponents ?? []).map((fee) => fee.amount)];
    if (input.published && fees.some((amount) => amount !== null && amount !== undefined) && !/^[A-Z]{3}$/.test(input.currency ?? '')) {
      throw new ApiException('VALIDATION_ERROR', 'Published fee amounts require a valid ISO currency.', 400);
    }
    for (const amount of fees) if (amount !== null && amount !== undefined && (typeof amount !== 'string' || !/^\d{1,10}(?:\.\d{1,2})?$/.test(amount) || Number(amount) < 0)) {
      throw new ApiException('VALIDATION_ERROR', 'Visa fee amounts must be non-negative decimal values.', 400);
    }
    if (input.published) {
      const configured = fees.filter((amount): amount is string => amount !== null && amount !== undefined);
      const totalCents = configured.reduce((total, amount) => {
        const [whole, fraction = ''] = amount.split('.');
        return total + BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
      }, 0n);
      if (!configured.length || totalCents <= 0n) {
        throw new ApiException('VALIDATION_ERROR', 'Published visa services need at least one positive configured fee for checkout.', 400);
      }
    }
    for (const fee of input.otherFeeComponents ?? []) if (!fee || typeof fee.code !== 'string' || !/^[A-Z][A-Z0-9_]{1,39}$/.test(fee.code) ||
        typeof fee.label !== 'string' || !fee.label.trim() || fee.label.length > 120 || typeof fee.amount !== 'string') {
      throw new ApiException('VALIDATION_ERROR', 'A fee component is invalid.', 400);
    }
    for (const country of input.nationalityEligibility ?? []) if (!/^[A-Z]{2}$/.test(country)) throw new ApiException('VALIDATION_ERROR', 'Nationality eligibility must use ISO alpha-2 codes.', 400);
    if (input.published && !input.processingTimeText?.trim()) throw new ApiException('VALIDATION_ERROR', 'Add verified processing-time information before publishing.', 400);
    if (input.effectiveFrom && input.effectiveUntil && input.effectiveUntil < input.effectiveFrom) throw new ApiException('VALIDATION_ERROR', 'The service effective dates are invalid.', 400);
    const form = parseVisaFormDefinition(input.formDefinition);
    if (input.published && !form.sections.some((section) => section.fields.length > 0)) {
      throw new ApiException('VALIDATION_ERROR', 'Add and review the customer application form before publishing.', 400);
    }
  }

  async processingDetail(id: string) {
    const db = this.db;
    const [application] = await db.select({ application: visaApplications, customerName: customers.displayName,
      visaTypeName: visaTypes.name, visaTypeCode: visaTypes.code, tripTitle: trips.title })
      .from(visaApplications).innerJoin(customers, eq(visaApplications.customerId, customers.id))
      .innerJoin(visaTypes, eq(visaApplications.visaTypeId, visaTypes.id))
      .innerJoin(trips, eq(visaApplications.tripId, trips.id))
      .where(and(eq(visaApplications.id, id), isNull(visaApplications.archivedAt))).limit(1);
    if (!application) throw new ApiException('NOT_FOUND', 'Visa application not found.', 404);
    const [people, requirements, history, requests, notes, orderRow] = await Promise.all([
      db.select({ id: travellers.id, legalFirstName: travellers.legalFirstName, legalMiddleName: travellers.legalMiddleName,
        legalLastName: travellers.legalLastName, dateOfBirth: travellers.dateOfBirth, gender: travellers.gender,
        nationalityCountryCode: travellers.nationalityCountryCode }).from(visaApplicationTravellers)
        .innerJoin(travellers, eq(visaApplicationTravellers.travellerId, travellers.id))
        .where(eq(visaApplicationTravellers.applicationId, id)),
      db.select({ requirement: visaApplicationRequirements, documentId: documents.id, documentVersionId: documentVersions.id,
        documentType: documents.documentType, displayName: documents.displayName, filename: documentVersions.originalFilename,
        versionNumber: documentVersions.versionNumber, securityScanStatus: documentVersions.securityScanStatus,
        uploadState: documentVersions.uploadState })
        .from(visaApplicationRequirements).leftJoin(visaRequirementDocuments, eq(visaRequirementDocuments.applicationRequirementId, visaApplicationRequirements.id))
        .leftJoin(documents, eq(visaRequirementDocuments.documentId, documents.id))
        .leftJoin(documentVersions, eq(visaRequirementDocuments.documentVersionId, documentVersions.id))
        .where(eq(visaApplicationRequirements.applicationId, id)).orderBy(asc(visaApplicationRequirements.displayOrder)),
      db.select().from(visaStatusHistory).where(eq(visaStatusHistory.applicationId, id)).orderBy(asc(visaStatusHistory.createdAt)),
      db.select().from(visaReviewRequests).where(eq(visaReviewRequests.applicationId, id)).orderBy(desc(visaReviewRequests.createdAt)),
      db.select().from(visaApplicationNotes).where(eq(visaApplicationNotes.applicationId, id)).orderBy(desc(visaApplicationNotes.createdAt)),
      db.select({ order: orders, payment: payments }).from(orders).leftJoin(payments, eq(payments.orderId, orders.id)).where(eq(orders.visaApplicationId, id)).limit(1),
    ]);
    const r = new Map<string, Record<string, unknown>>();
    for (const row of requirements) {
      const req = row.requirement;
      const entry = r.get(req.id) ?? { id: req.id, travellerId: req.travellerId, requirementCode: req.requirementCode,
        name: req.nameSnapshot, description: req.descriptionSnapshot, required: req.requiredSnapshot, documentType: req.documentTypeSnapshot,
        conditionSnapshot: req.conditionSnapshot, status: req.status, reviewNote: req.reviewNote,
        reviewedAt: req.reviewedAt?.toISOString() ?? null, documents: [] as Record<string, unknown>[] };
      if (row.documentId && row.documentVersionId) (entry.documents as Record<string, unknown>[]).push({ documentId: row.documentId,
        documentVersionId: row.documentVersionId, documentType: row.documentType, displayName: row.displayName,
        filename: row.filename, versionNumber: row.versionNumber, scanStatus: row.securityScanStatus, uploadState: row.uploadState });
      r.set(req.id, entry);
    }
    const order = orderRow[0];
    return { id, reference: application.application.applicationReference, customerId: application.application.customerId,
      customerName: application.customerName, tripId: application.application.tripId, tripTitle: application.tripTitle,
      visaTypeId: application.application.visaTypeId, visaTypeName: application.visaTypeName, visaTypeCode: application.visaTypeCode,
      destinationCountryCode: application.application.destinationCountryCode, status: application.application.status,
      createdAt: application.application.createdAt.toISOString(), submittedAt: application.application.submittedAt?.toISOString() ?? null,
      updatedAt: application.application.updatedAt.toISOString(), serviceSnapshot: application.application.serviceSnapshot,
      formSnapshot: parseVisaFormDefinition(application.application.formSnapshot), answers: application.application.answers,
      feeSnapshot: application.application.feeSnapshot, declarationVersion: application.application.declarationVersion,
      declarationAcceptedAt: application.application.declarationAcceptedAt?.toISOString() ?? null,
      travellers: people, requirements: [...r.values()], timeline: history.map((item) => ({ fromStatus: item.fromStatus, toStatus: item.toStatus,
        actorType: item.actorType, reasonCode: item.reasonCode, customerMessage: item.customerMessage,
        createdAt: item.createdAt.toISOString() })), requests: requests.map((item) => ({ id: item.id, requirementId: item.applicationRequirementId,
        travellerId: item.travellerId, fieldKey: item.fieldKey, type: item.requestType, reason: item.reason, dueAt: item.dueAt?.toISOString() ?? null,
        status: item.status, createdAt: item.createdAt.toISOString() })), notes: notes.map((item) => ({ id: item.id,
        visibility: item.visibility, note: item.note, staffUserId: item.staffUserId, createdAt: item.createdAt.toISOString() })),
      order: order ? { id: order.order.id, orderNumber: order.order.orderNumber, status: order.order.status,
        amount: order.order.totalAmount, currency: order.order.currency, paidAt: order.order.paidAt?.toISOString() ?? null,
        paymentStatus: order.payment?.status ?? null } : null };
  }

  async changeStatus(id: string, status: VisaStaffStatus, customerMessage: string | undefined, internalNote: string | undefined,
    staff: AdminIdentity, requestId: string) {
    return this.db.transaction(async (tx) => {
      const [application] = await tx.select().from(visaApplications).where(and(eq(visaApplications.id, id), isNull(visaApplications.archivedAt))).for('update').limit(1);
      if (!application) throw new ApiException('NOT_FOUND', 'Visa application not found.', 404);
      if (!transitions[application.status as VisaApplicationStatus]?.includes(status)) throw new ApiException('CONFLICT', 'That visa status transition is not allowed.', 409);
      const now = new Date();
      await tx.update(visaApplications).set({ status, completedAt: ['COMPLETED', 'REJECTED', 'CANCELLED'].includes(status) ? now : application.completedAt, updatedAt: now }).where(eq(visaApplications.id, id));
      await tx.insert(visaStatusHistory).values({ applicationId: id, fromStatus: application.status, toStatus: status,
        actorType: 'STAFF', actorStaffUserId: staff.staffUserId, reasonCode: 'STAFF_UPDATE',
        customerMessage: customerMessage?.trim() || null, internalNote: internalNote?.trim() || null });
      await tx.insert(auditEvents).values({ actorCustomerId: application.customerId, tripId: application.tripId,
        visaApplicationId: id, event: 'visa.status.changed' });
      await tx.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role, event: 'visa.status.changed',
        resourceType: 'visa_application', resourceId: id, requestId });
      return { id, status, updatedAt: now.toISOString() };
    });
  }

  async reviewRequirement(id: string, requirementId: string, status: 'UNDER_REVIEW' | 'ACCEPTED' | 'REPLACEMENT_REQUIRED' | 'NOT_APPLICABLE',
    reason: string | undefined, staff: AdminIdentity, requestId: string) {
    if (status === 'REPLACEMENT_REQUIRED' && !reason?.trim()) throw new ApiException('VALIDATION_ERROR', 'Give the customer a reason for the replacement.', 400);
    if (status === 'NOT_APPLICABLE' && !reason?.trim()) throw new ApiException('VALIDATION_ERROR', 'Give a reason for marking this item not applicable.', 400);
    return this.db.transaction(async (tx) => {
      const [application] = await tx.select({ id: visaApplications.id, customerId: visaApplications.customerId, tripId: visaApplications.tripId,
        status: visaApplications.status }).from(visaApplications).where(and(eq(visaApplications.id, id), isNull(visaApplications.archivedAt))).for('update').limit(1);
      const [requirement] = await tx.select().from(visaApplicationRequirements).where(and(eq(visaApplicationRequirements.id, requirementId), eq(visaApplicationRequirements.applicationId, id))).limit(1);
      if (!application || !requirement) throw new ApiException('NOT_FOUND', 'Visa requirement not found.', 404);
      if (['COMPLETED', 'CANCELLED', 'REJECTED'].includes(application.status)) throw new ApiException('CONFLICT', 'This application is closed.', 409);
      if (!['PAID', 'DOCUMENT_REVIEW', 'ADDITIONAL_DOCUMENTS_REQUIRED', 'APPLICATION_PREPARATION'].includes(application.status)) {
        throw new ApiException('CONFLICT', 'Document review is available after payment and intake.', 409);
      }
      if (status === 'ACCEPTED') {
        const [safeFile] = await tx.select({ id: documentVersions.id }).from(visaRequirementDocuments)
          .innerJoin(documents, eq(visaRequirementDocuments.documentId, documents.id))
          .innerJoin(documentVersions, eq(visaRequirementDocuments.documentVersionId, documentVersions.id))
          .where(and(eq(visaRequirementDocuments.applicationRequirementId, requirementId), eq(documents.customerId, application.customerId),
            eq(documentVersions.uploadState, 'UPLOADED'), eq(documentVersions.securityScanStatus, 'CLEAN'),
            or(isNull(documents.travellerId), eq(documents.travellerId, requirement.travellerId))))
          .orderBy(desc(documentVersions.versionNumber)).limit(1);
        if (!safeFile) throw new ApiException('CONFLICT', 'This item has no securely scanned file to accept.', 409);
      }
      await tx.update(visaApplicationRequirements).set({ status, reviewNote: reason?.trim() ?? null,
        reviewedByStaffId: staff.staffUserId, reviewedAt: new Date(), updatedAt: new Date() }).where(eq(visaApplicationRequirements.id, requirementId));
      if (status === 'ACCEPTED') {
        await tx.update(visaReviewRequests).set({ status: 'RESOLVED', resolvedAt: new Date() })
          .where(and(eq(visaReviewRequests.applicationId, id), eq(visaReviewRequests.applicationRequirementId, requirementId), eq(visaReviewRequests.status, 'OPEN')));
        const remaining = await tx.select({ requestType: visaReviewRequests.requestType }).from(visaReviewRequests)
          .where(and(eq(visaReviewRequests.applicationId, id), eq(visaReviewRequests.status, 'OPEN')));
        const nextStatus: VisaApplicationStatus | null = !remaining.length ? 'DOCUMENT_REVIEW'
          : remaining.some((item) => item.requestType === 'DOCUMENT') ? 'ADDITIONAL_DOCUMENTS_REQUIRED'
            : remaining.some((item) => ['ANSWER', 'ADDITIONAL_INFO'].includes(item.requestType)) ? 'ADDITIONAL_INFORMATION_REQUIRED' : null;
        if (nextStatus && application.status !== nextStatus) {
          await tx.update(visaApplications).set({ status: nextStatus, updatedAt: new Date() }).where(eq(visaApplications.id, id));
          await tx.insert(visaStatusHistory).values({ applicationId: id, fromStatus: application.status, toStatus: nextStatus,
            actorType: 'STAFF', actorStaffUserId: staff.staffUserId, reasonCode: 'DOCUMENT_REPLACEMENT_ACCEPTED' });
          await tx.insert(auditEvents).values({ actorCustomerId: application.customerId, tripId: application.tripId, visaApplicationId: id, event: 'visa.status.changed' });
        }
      }
      if (status === 'REPLACEMENT_REQUIRED') {
        const [open] = await tx.select({ id: visaReviewRequests.id }).from(visaReviewRequests)
          .where(and(eq(visaReviewRequests.applicationId, id), eq(visaReviewRequests.applicationRequirementId, requirementId), eq(visaReviewRequests.status, 'OPEN'))).limit(1);
        if (!open) await tx.insert(visaReviewRequests).values({ applicationId: id, applicationRequirementId: requirementId,
          travellerId: requirement.travellerId, requestType: 'DOCUMENT', reason: reason!.trim(), requestedByStaffId: staff.staffUserId });
        if (application.status !== 'ADDITIONAL_DOCUMENTS_REQUIRED') {
          await tx.update(visaApplications).set({ status: 'ADDITIONAL_DOCUMENTS_REQUIRED', updatedAt: new Date() }).where(eq(visaApplications.id, id));
          await tx.insert(visaStatusHistory).values({ applicationId: id, fromStatus: application.status, toStatus: 'ADDITIONAL_DOCUMENTS_REQUIRED',
            actorType: 'STAFF', actorStaffUserId: staff.staffUserId, reasonCode: 'DOCUMENT_REPLACEMENT_REQUESTED', customerMessage: reason!.trim() });
          await tx.insert(auditEvents).values({ actorCustomerId: application.customerId, tripId: application.tripId, visaApplicationId: id, event: 'visa.status.changed' });
        }
      }
      await tx.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role,
        event: `visa.document.${status.toLowerCase()}`, resourceType: 'visa_application_requirement', resourceId: requirementId, requestId });
      return { requirementId, status };
    });
  }

  async requestCorrection(id: string, input: { requestType: 'DOCUMENT' | 'ANSWER' | 'ADDITIONAL_INFO'; reason: string;
    requirementId?: string; travellerId?: string; fieldKey?: string; dueAt?: string }, staff: AdminIdentity, requestId: string) {
    return this.db.transaction(async (tx) => {
      if (input.requestType === 'DOCUMENT' && !input.requirementId) {
        throw new ApiException('VALIDATION_ERROR', 'Choose the document requirement that needs correction.', 400);
      }
      if (input.requestType === 'ANSWER' && !input.fieldKey) {
        throw new ApiException('VALIDATION_ERROR', 'Choose the exact answer that needs correction.', 400);
      }
      if (input.requestType === 'ADDITIONAL_INFO' && !input.fieldKey) {
        throw new ApiException('VALIDATION_ERROR', 'Choose the exact application answer that needs more information.', 400);
      }
      const [application] = await tx.select().from(visaApplications).where(and(eq(visaApplications.id, id), isNull(visaApplications.archivedAt))).for('update').limit(1);
      if (!application) throw new ApiException('NOT_FOUND', 'Visa application not found.', 404);
      if (['COMPLETED', 'CANCELLED', 'REJECTED'].includes(application.status)) throw new ApiException('CONFLICT', 'This application is closed.', 409);
      if (!['PAID', 'DOCUMENT_REVIEW', 'ADDITIONAL_DOCUMENTS_REQUIRED', 'ADDITIONAL_INFORMATION_REQUIRED', 'APPLICATION_PREPARATION',
        'READY_FOR_SUBMISSION_TO_AUTHORITY', 'SUBMITTED_TO_EMBASSY_OR_AUTHORITY', 'UNDER_PROCESSING'].includes(application.status)) {
        throw new ApiException('CONFLICT', 'Customer corrections are available after payment and intake.', 409);
      }
      if (input.requirementId) {
        const [requirement] = await tx.select({ id: visaApplicationRequirements.id }).from(visaApplicationRequirements)
          .where(and(eq(visaApplicationRequirements.id, input.requirementId), eq(visaApplicationRequirements.applicationId, id))).limit(1);
        if (!requirement) throw new ApiException('NOT_FOUND', 'Visa requirement not found.', 404);
      }
      if (input.travellerId) {
        const [traveller] = await tx.select({ id: visaApplicationTravellers.travellerId }).from(visaApplicationTravellers)
          .where(and(eq(visaApplicationTravellers.applicationId, id), eq(visaApplicationTravellers.travellerId, input.travellerId))).limit(1);
        if (!traveller) throw new ApiException('NOT_FOUND', 'Applicant not found.', 404);
      }
      if (input.fieldKey) {
        const form = parseVisaFormDefinition(application.formSnapshot);
        const field = form.sections.flatMap((section) => section.fields).find((item) => item.key === input.fieldKey);
        if (!field || field.applicantScope === 'APPLICATION' && input.travellerId || field.applicantScope !== 'APPLICATION' && !input.travellerId) {
          throw new ApiException('VALIDATION_ERROR', 'Choose an answer in the correct application or applicant section.', 400);
        }
      }
      const [created] = await tx.insert(visaReviewRequests).values({ applicationId: id,
        applicationRequirementId: input.requirementId ?? null, travellerId: input.travellerId ?? null,
        fieldKey: input.fieldKey ?? null, requestType: input.requestType, reason: input.reason.trim(),
        dueAt: input.dueAt ? new Date(input.dueAt) : null, requestedByStaffId: staff.staffUserId }).returning({ id: visaReviewRequests.id });
      const openRequests = await tx.select({ requestType: visaReviewRequests.requestType }).from(visaReviewRequests)
        .where(and(eq(visaReviewRequests.applicationId, id), eq(visaReviewRequests.status, 'OPEN')));
      const next = openRequests.some((item) => item.requestType === 'DOCUMENT')
        ? 'ADDITIONAL_DOCUMENTS_REQUIRED' : 'ADDITIONAL_INFORMATION_REQUIRED';
      if (application.status !== next) {
        await tx.update(visaApplications).set({ status: next, updatedAt: new Date() }).where(eq(visaApplications.id, id));
        await tx.insert(visaStatusHistory).values({ applicationId: id, fromStatus: application.status, toStatus: next,
          actorType: 'STAFF', actorStaffUserId: staff.staffUserId, reasonCode: 'CORRECTION_REQUESTED', customerMessage: input.reason.trim() });
        await tx.insert(auditEvents).values({ actorCustomerId: application.customerId, tripId: application.tripId, visaApplicationId: id, event: 'visa.status.changed' });
      }
      await tx.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role, event: 'visa.correction.requested',
        resourceType: 'visa_application', resourceId: id, requestId });
      return { id: created!.id, status: 'OPEN' as const };
    });
  }

  async addNote(id: string, note: string, visibility: 'INTERNAL' | 'CUSTOMER', staff: AdminIdentity, requestId: string) {
    const [application] = await this.db.select({ id: visaApplications.id }).from(visaApplications)
      .where(and(eq(visaApplications.id, id), isNull(visaApplications.archivedAt))).limit(1);
    if (!application) throw new ApiException('NOT_FOUND', 'Visa application not found.', 404);
    const [row] = await this.db.insert(visaApplicationNotes).values({ applicationId: id, staffUserId: staff.staffUserId, visibility, note: note.trim() }).returning();
    await audit(this.db, staff, requestId, `visa.note.${visibility.toLowerCase()}.created`, id);
    return { id: row!.id, visibility, createdAt: row!.createdAt.toISOString() };
  }

  async assertApplicationDocument(id: string, documentId: string, versionId: string) {
    const [link] = await this.db.select({ id: visaRequirementDocuments.id }).from(visaRequirementDocuments)
      .innerJoin(visaApplicationRequirements, eq(visaRequirementDocuments.applicationRequirementId, visaApplicationRequirements.id))
      .innerJoin(visaApplications, eq(visaApplicationRequirements.applicationId, visaApplications.id))
      .where(and(eq(visaApplications.id, id), eq(visaRequirementDocuments.documentId, documentId),
        eq(visaRequirementDocuments.documentVersionId, versionId), isNull(visaApplications.archivedAt))).limit(1);
    if (!link) throw new ApiException('NOT_FOUND', 'Application document not found.', 404);
    return true;
  }
}

