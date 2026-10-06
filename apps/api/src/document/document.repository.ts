import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import { auditEvents, customerTravellers, documents, documentVersions, travellers, type DatabaseConnection } from '@flyseri/database';
import type { DocumentDetail, DocumentInput, DocumentSummary, DocumentType, DocumentVersion } from '@flyseri/types';
import { personBoundDocumentTypes } from './dto.js';

export class DocumentTravellerUnavailableError extends Error {}
export class DocumentConflictError extends Error {}
export class DocumentDateError extends Error {}
export interface DocumentFilter { travellerId?: string; documentType?: DocumentType; status?: string }
export interface UploadReservation { id: string; path: string; state: 'PENDING' | 'UPLOADED' | 'FAILED'; checksumSha256: string }
export interface DocumentStore {
  list(customerId: string, filter: DocumentFilter): Promise<DocumentSummary[]>;
  detail(customerId: string, documentId: string): Promise<DocumentDetail | null>;
  create(customerId: string, input: DocumentInput): Promise<DocumentDetail>;
  update(customerId: string, documentId: string, patch: Partial<DocumentInput>): Promise<DocumentDetail | null>;
  archive(customerId: string, documentId: string): Promise<boolean>;
  reserve(customerId: string, documentId: string, input: { id: string; idempotencyKey: string; path: string; filename: string; mimeType: string; size: number; checksumSha256: string }): Promise<UploadReservation | null>;
  complete(customerId: string, documentId: string, versionId: string): Promise<void>;
  fail(customerId: string, documentId: string, versionId: string): Promise<void>;
  versionForAccess(customerId: string, documentId: string, versionId?: string): Promise<{ path: string; id: string } | null>;
  auditAccess(customerId: string, documentId: string, download: boolean): Promise<void>;
}

type DocumentRow = typeof documents.$inferSelect;
type VersionRow = typeof documentVersions.$inferSelect;
const versionDto = (row: VersionRow): DocumentVersion => ({ id: row.id, versionNumber: row.versionNumber, originalFilename: row.originalFilename, mimeType: row.mimeType, fileSize: row.fileSize, securityScanStatus: row.securityScanStatus as DocumentVersion['securityScanStatus'], uploadedAt: row.uploadedAt?.toISOString() ?? null });
function documentDto(row: DocumentRow, travellerName: string | null, versions: VersionRow[]): DocumentDetail {
  const visible = versions.filter((item) => item.uploadState === 'UPLOADED').sort((a, b) => b.versionNumber - a.versionNumber).map(versionDto);
  return { id: row.id, travellerId: row.travellerId, travellerName, documentType: row.documentType as DocumentDetail['documentType'], displayName: row.displayName, status: row.status as DocumentDetail['status'], issuedOn: row.issuedOn, expiresOn: row.expiresOn, issuingCountryCode: row.issuingCountryCode, currentVersion: visible[0] ?? null, versions: visible, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() };
}
export class DrizzleDocumentStore implements DocumentStore {
  constructor(private readonly connection: DatabaseConnection) {}
  private async ownedTraveller(customerId: string, travellerId: string | null | undefined): Promise<void> {
    if (!travellerId) return;
    const [row] = await this.connection.db.select({ id: customerTravellers.id }).from(customerTravellers)
      .innerJoin(travellers, eq(customerTravellers.travellerId, travellers.id))
      .where(and(eq(customerTravellers.customerId, customerId), eq(customerTravellers.travellerId, travellerId), isNull(travellers.archivedAt))).limit(1);
    if (!row) throw new DocumentTravellerUnavailableError();
  }
  async list(customerId: string, filter: DocumentFilter): Promise<DocumentSummary[]> {
    const conditions = [eq(documents.customerId, customerId), isNull(documents.archivedAt)];
    if (filter.travellerId) conditions.push(eq(documents.travellerId, filter.travellerId));
    if (filter.documentType) conditions.push(eq(documents.documentType, filter.documentType));
    if (filter.status) conditions.push(eq(documents.status, filter.status));
    const rows = await this.connection.db.select().from(documents).where(and(...conditions)).orderBy(desc(documents.createdAt));
    if (!rows.length) return [];
    const ids = rows.map((row) => row.id);
    const travellerIds = [...new Set(rows.map((row) => row.travellerId).filter((id): id is string => !!id))];
    const [versions, people] = await Promise.all([
      this.connection.db.select().from(documentVersions).where(and(inArray(documentVersions.documentId, ids), eq(documentVersions.uploadState, 'UPLOADED'))),
      travellerIds.length ? this.connection.db.select({ id: travellers.id, first: travellers.legalFirstName, last: travellers.legalLastName }).from(travellers).where(inArray(travellers.id, travellerIds)) : Promise.resolve([]),
    ]);
    const names = new Map(people.map((person) => [person.id, `${person.first} ${person.last}`]));
    const byDocument = new Map<string, VersionRow[]>();
    for (const item of versions) byDocument.set(item.documentId, [...(byDocument.get(item.documentId) ?? []), item]);
    return rows.map((row) => {
      const { versions: _versions, ...summary } = documentDto(row, row.travellerId ? names.get(row.travellerId) ?? null : null, byDocument.get(row.id) ?? []);
      return summary;
    });
  }
  async detail(customerId: string, documentId: string): Promise<DocumentDetail | null> {
    const [row] = await this.connection.db.select().from(documents).where(and(eq(documents.id, documentId), eq(documents.customerId, customerId), isNull(documents.archivedAt))).limit(1);
    if (!row) return null;
    const [versions, person] = await Promise.all([
      this.connection.db.select().from(documentVersions).where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.uploadState, 'UPLOADED'))),
      row.travellerId ? this.connection.db.select({ first: travellers.legalFirstName, last: travellers.legalLastName }).from(travellers).where(eq(travellers.id, row.travellerId)).limit(1) : Promise.resolve([]),
    ]);
    const name = person[0] ? `${person[0].first} ${person[0].last}` : null;
    return documentDto(row, name, versions);
  }
  async create(customerId: string, input: DocumentInput): Promise<DocumentDetail> {
    await this.ownedTraveller(customerId, input.travellerId);
    const [row] = await this.connection.db.transaction(async (tx) => {
      const inserted = await tx.insert(documents).values({ customerId, travellerId: input.travellerId ?? null, documentType: input.documentType, displayName: input.displayName ?? null, status: 'PROCESSING', issuedOn: input.issuedOn ?? null, expiresOn: input.expiresOn ?? null, issuingCountryCode: input.issuingCountryCode ?? null }).returning({ id: documents.id });
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, documentId: inserted[0]!.id, event: 'document.created' });
      return inserted;
    });
    return (await this.detail(customerId, row!.id))!;
  }
  async update(customerId: string, documentId: string, patch: Partial<DocumentInput>): Promise<DocumentDetail | null> {
    const [owned] = await this.connection.db.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.customerId, customerId), isNull(documents.archivedAt))).limit(1);
    if (!owned) return null;
    await this.ownedTraveller(customerId, patch.travellerId);
    const changed = await this.connection.db.transaction(async (tx) => {
      const [current] = await tx.select({ issuedOn: documents.issuedOn, expiresOn: documents.expiresOn, documentType: documents.documentType }).from(documents).where(and(eq(documents.id, documentId), eq(documents.customerId, customerId), isNull(documents.archivedAt))).limit(1);
      if (!current) return false;
      if (patch.travellerId === null && personBoundDocumentTypes.includes(current.documentType as DocumentType)) throw new DocumentTravellerUnavailableError();
      const issued = patch.issuedOn === undefined ? current.issuedOn : patch.issuedOn;
      const expires = patch.expiresOn === undefined ? current.expiresOn : patch.expiresOn;
      if (issued && expires && expires < issued) throw new DocumentDateError();
      const [row] = await tx.update(documents).set({ ...(patch.travellerId !== undefined && { travellerId: patch.travellerId }), ...(patch.displayName !== undefined && { displayName: patch.displayName }), ...(patch.issuedOn !== undefined && { issuedOn: patch.issuedOn }), ...(patch.expiresOn !== undefined && { expiresOn: patch.expiresOn }), ...(patch.issuingCountryCode !== undefined && { issuingCountryCode: patch.issuingCountryCode }), updatedAt: new Date() })
        .where(and(eq(documents.id, documentId), eq(documents.customerId, customerId), isNull(documents.archivedAt))).returning({ id: documents.id });
      if (!row) return false;
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, documentId, event: 'document.updated' });
      return true;
    });
    return changed ? this.detail(customerId, documentId) : null;
  }
  async archive(customerId: string, documentId: string): Promise<boolean> {
    return this.connection.db.transaction(async (tx) => {
      const [row] = await tx.update(documents).set({ status: 'ARCHIVED', archivedAt: new Date(), updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.customerId, customerId), isNull(documents.archivedAt))).returning({ id: documents.id });
      if (!row) return false;
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, documentId, event: 'document.archived' });
      return true;
    });
  }
  async reserve(customerId: string, documentId: string, input: { id: string; idempotencyKey: string; path: string; filename: string; mimeType: string; size: number; checksumSha256: string }): Promise<UploadReservation | null> {
    return this.connection.db.transaction(async (tx) => {
      const [document] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.customerId, customerId), isNull(documents.archivedAt))).limit(1);
      if (!document) return null;
      const [existing] = await tx.select().from(documentVersions).where(and(eq(documentVersions.documentId, documentId), eq(documentVersions.idempotencyKey, input.idempotencyKey))).limit(1);
      if (existing) return { id: existing.id, path: existing.storagePath, state: existing.uploadState as UploadReservation['state'], checksumSha256: existing.checksumSha256 };
      const [number] = await tx.update(documents).set({ nextVersion: sql`${documents.nextVersion} + 1`, updatedAt: new Date() }).where(eq(documents.id, documentId)).returning({ nextVersion: documents.nextVersion });
      const versionNumber = number!.nextVersion - 1;
      await tx.insert(documentVersions).values({ id: input.id, documentId, storagePath: input.path, originalFilename: input.filename, mimeType: input.mimeType, fileSize: input.size, checksumSha256: input.checksumSha256, versionNumber, idempotencyKey: input.idempotencyKey, uploadState: 'PENDING', securityScanStatus: 'UNAVAILABLE' });
      return { id: input.id, path: input.path, state: 'PENDING', checksumSha256: input.checksumSha256 };
    });
  }
  async complete(customerId: string, documentId: string, versionId: string): Promise<void> {
    await this.connection.db.transaction(async (tx) => {
      const [document] = await tx.select({ id: documents.id }).from(documents).where(and(eq(documents.id, documentId), eq(documents.customerId, customerId), isNull(documents.archivedAt))).limit(1);
      if (!document) throw new DocumentConflictError();
      const [row] = await tx.update(documentVersions).set({ uploadState: 'UPLOADED', uploadedAt: new Date() }).where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId), eq(documentVersions.uploadState, 'PENDING'))).returning({ id: documentVersions.id });
      if (!row) throw new DocumentConflictError();
      await tx.update(documents).set({ status: 'UPLOADED', updatedAt: new Date() }).where(and(eq(documents.id, documentId), eq(documents.customerId, customerId), isNull(documents.archivedAt)));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, documentId, event: 'document.version.uploaded' });
    });
  }
  async fail(customerId: string, documentId: string, versionId: string): Promise<void> {
    await this.connection.db.update(documentVersions).set({ uploadState: 'FAILED' }).where(and(eq(documentVersions.id, versionId), eq(documentVersions.documentId, documentId), eq(documentVersions.uploadState, 'PENDING')));
  }
  async versionForAccess(customerId: string, documentId: string, versionId?: string): Promise<{ path: string; id: string } | null> {
    const conditions = [eq(documents.id, documentId), eq(documents.customerId, customerId), isNull(documents.archivedAt), eq(documentVersions.uploadState, 'UPLOADED')];
    if (versionId) conditions.push(eq(documentVersions.id, versionId));
    const [row] = await this.connection.db.select({ id: documentVersions.id, path: documentVersions.storagePath }).from(documentVersions).innerJoin(documents, eq(documentVersions.documentId, documents.id)).where(and(...conditions)).orderBy(desc(documentVersions.versionNumber)).limit(1);
    return row ?? null;
  }
  async auditAccess(customerId: string, documentId: string, download: boolean): Promise<void> {
    await this.connection.db.insert(auditEvents).values({ actorCustomerId: customerId, documentId, event: download ? 'document.downloaded' : 'document.viewed' });
  }
}
