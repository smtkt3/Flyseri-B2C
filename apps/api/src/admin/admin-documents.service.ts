import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, isNull, type SQL } from 'drizzle-orm';
import { adminAuditEvents, customers, documents, documentVersions, type DatabaseConnection } from '@flyseri/database';
import type { AppConfig } from '@flyseri/config';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG, DATABASE_CONNECTION, DOCUMENT_STORAGE } from '../tokens.js';
import type { DocumentStorage } from '../document/storage.js';
import type { AdminIdentity } from './admin-auth.js';
import type { AdminListQuery } from './admin-records.service.js';

@Injectable()
export class AdminDocumentsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage | undefined,
    @Inject(APP_CONFIG) private readonly config: AppConfig) {}
  private get db() {
    if (!this.connection) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Flyseri data is unavailable.', 503);
    return this.connection.db;
  }
  async list(query: AdminListQuery) {
    const db = this.db;
    const filters: SQL[] = [isNull(documents.archivedAt)];
    if (query.customerId) filters.push(eq(documents.customerId, query.customerId));
    if (query.status) filters.push(eq(documents.status, query.status));
    if (query.search) filters.push(ilike(documents.displayName, `%${query.search}%`));
    const where = and(...filters);
    const [rows, total] = await Promise.all([
      db.select({ id: documents.id, customerId: documents.customerId, customerName: customers.displayName,
        travellerId: documents.travellerId, documentType: documents.documentType, displayName: documents.displayName,
        status: documents.status, createdAt: documents.createdAt, updatedAt: documents.updatedAt })
        .from(documents).innerJoin(customers, eq(documents.customerId, customers.id))
        .where(where).orderBy(desc(documents.updatedAt), desc(documents.id)).limit(query.limit).offset((query.page - 1) * query.limit),
      db.select({ count: count() }).from(documents).where(where),
    ]);
    return { items: rows.map((row) => ({ ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString() })),
      total: total[0]?.count ?? 0, page: query.page, limit: query.limit };
  }
  async detail(id: string) {
    const db = this.db;
    const [row] = await db.select({ id: documents.id, customerId: documents.customerId, customerName: customers.displayName,
      travellerId: documents.travellerId, documentType: documents.documentType, displayName: documents.displayName,
      status: documents.status, createdAt: documents.createdAt, updatedAt: documents.updatedAt })
      .from(documents).innerJoin(customers, eq(documents.customerId, customers.id))
      .where(and(eq(documents.id, id), isNull(documents.archivedAt))).limit(1);
    if (!row) throw new ApiException('NOT_FOUND', 'Document not found.', 404);
    const versions = await db.select({ id: documentVersions.id, versionNumber: documentVersions.versionNumber,
      mimeType: documentVersions.mimeType, fileSize: documentVersions.fileSize, uploadState: documentVersions.uploadState,
      securityScanStatus: documentVersions.securityScanStatus, uploadedAt: documentVersions.uploadedAt })
      .from(documentVersions).where(eq(documentVersions.documentId, id)).orderBy(desc(documentVersions.versionNumber));
    return { ...row, createdAt: row.createdAt.toISOString(), updatedAt: row.updatedAt.toISOString(),
      versions: versions.map((version) => ({ ...version, uploadedAt: version.uploadedAt?.toISOString() ?? null })) };
  }
  async access(id: string, versionId: string, staff: AdminIdentity, requestId: string, download: boolean) {
    const db = this.db;
    if (!this.storage) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Private document storage is unavailable.', 503);
    const [row] = await db.select({ path: documentVersions.storagePath, uploadState: documentVersions.uploadState })
      .from(documentVersions).innerJoin(documents, eq(documentVersions.documentId, documents.id))
      .where(and(eq(documents.id, id), eq(documentVersions.id, versionId), isNull(documents.archivedAt))).limit(1);
    if (!row || row.uploadState !== 'UPLOADED') throw new ApiException('NOT_FOUND', 'Document version not found.', 404);
    let url: string;
    try {
      url = await this.storage.signedUrl(row.path, this.config.DOCUMENT_SIGNED_URL_TTL_SECONDS, download);
      if (new URL(url).protocol !== 'https:') throw new Error('Invalid signed URL');
    }
    catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Private document access is unavailable.', 503); }
    await db.insert(adminAuditEvents).values({ staffUserId: staff.staffUserId, staffRole: staff.role,
      event: download ? 'document.download_url_issued' : 'document.view_url_issued', resourceType: 'document_version',
      resourceId: versionId, requestId });
    return { url, expiresInSeconds: this.config.DOCUMENT_SIGNED_URL_TTL_SECONDS };
  }
}
