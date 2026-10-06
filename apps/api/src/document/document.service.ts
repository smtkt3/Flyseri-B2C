import { randomUUID } from 'node:crypto';
import { BadRequestException, Inject, Injectable } from '@nestjs/common';
import type { AppConfig } from '@flyseri/config';
import type { DocumentAccess, DocumentDetail, DocumentInput, DocumentSummary } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG, DOCUMENT_STORAGE, DOCUMENT_STORE } from '../tokens.js';
import { DocumentConflictError, DocumentDateError, DocumentTravellerUnavailableError, type DocumentFilter, type DocumentStore } from './document.repository.js';
import { validateUpload, type UploadFile } from './file-validation.js';
import type { DocumentStorage } from './storage.js';
import { personBoundDocumentTypes } from './dto.js';

const missing = () => new ApiException('NOT_FOUND', 'The requested document was not found.', 404);
const storageUnavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', "We couldn't upload this document. Please try again.", 503);
@Injectable()
export class DocumentService {
  constructor(
    @Inject(DOCUMENT_STORE) private readonly store: DocumentStore | undefined,
    @Inject(DOCUMENT_STORAGE) private readonly storage: DocumentStorage | undefined,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}
  private required(): DocumentStore {
    if (!this.store) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Documents are temporarily unavailable.', 503);
    return this.store;
  }
  policy(): { maxUploadMb: number; acceptedTypes: string[] } { return { maxUploadMb: this.config.DOCUMENT_MAX_UPLOAD_MB, acceptedTypes: ['application/pdf', 'image/jpeg', 'image/png'] }; }
  list(customerId: string, filter: DocumentFilter): Promise<DocumentSummary[]> { return this.required().list(customerId, filter); }
  async detail(customerId: string, id: string): Promise<DocumentDetail> { return await this.required().detail(customerId, id) ?? Promise.reject(missing()); }
  async create(customerId: string, input: DocumentInput): Promise<DocumentDetail> {
    if (personBoundDocumentTypes.includes(input.documentType) && !input.travellerId) throw new ApiException('VALIDATION_ERROR', 'Choose the traveller this document belongs to.', 400);
    if (input.issuedOn && input.expiresOn && input.expiresOn < input.issuedOn) throw new BadRequestException();
    try { return await this.required().create(customerId, input); }
    catch (error) { if (error instanceof DocumentTravellerUnavailableError) throw new ApiException('VALIDATION_ERROR', 'Choose one of your saved travellers.', 400); throw error; }
  }
  async update(customerId: string, id: string, patch: Partial<DocumentInput>): Promise<DocumentDetail> {
    if (!Object.keys(patch).length) throw new BadRequestException();
    if (patch.issuedOn && patch.expiresOn && patch.expiresOn < patch.issuedOn) throw new BadRequestException();
    try { return await this.required().update(customerId, id, patch) ?? Promise.reject(missing()); }
    catch (error) { if (error instanceof DocumentTravellerUnavailableError || error instanceof DocumentDateError) throw new ApiException('VALIDATION_ERROR', 'Check the document details and try again.', 400); throw error; }
  }
  async archive(customerId: string, id: string): Promise<{ archived: true }> {
    if (!await this.required().archive(customerId, id)) throw missing();
    return { archived: true };
  }
  async upload(customerId: string, documentId: string, idempotencyKey: string | undefined, file: UploadFile | undefined): Promise<DocumentDetail> {
    if (!idempotencyKey || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(idempotencyKey)) throw new BadRequestException();
    const upload = validateUpload(file, this.config.DOCUMENT_MAX_UPLOAD_MB);
    if (!this.storage) throw storageUnavailable();
    const versionId = randomUUID();
    const path = `customers/${customerId}/documents/${documentId}/versions/${versionId}.${upload.extension}`;
    let reservation;
    try {
      reservation = await this.required().reserve(customerId, documentId, { id: versionId, idempotencyKey, path, filename: upload.filename, mimeType: upload.mimeType, size: upload.size, checksumSha256: upload.checksumSha256 });
    } catch (error) {
      if (error instanceof DocumentConflictError || (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')) throw new ApiException('CONFLICT', 'This upload is already in progress.', 409);
      throw error;
    }
    if (!reservation) throw missing();
    if (reservation.checksumSha256 !== upload.checksumSha256) throw new ApiException('CONFLICT', 'This upload request was already used for a different file.', 409);
    if (reservation.state === 'UPLOADED') return this.detail(customerId, documentId);
    if (reservation.id !== versionId || reservation.state !== 'PENDING') throw new ApiException('CONFLICT', 'This upload is already in progress. Please try again shortly.', 409);
    let uploaded = false;
    try {
      await this.storage.upload(path, upload.bytes, upload.mimeType);
      uploaded = true;
      await this.required().complete(customerId, documentId, versionId);
      return this.detail(customerId, documentId);
    } catch {
      if (uploaded) { try { await this.storage.remove(path); } catch { /* FAILED row retains path for reconciliation. */ } }
      try { await this.required().fail(customerId, documentId, versionId); } catch { /* Retry and reconciliation can inspect PENDING. */ }
      throw storageUnavailable();
    }
  }
  async access(customerId: string, documentId: string, versionId: string | undefined, download: boolean): Promise<DocumentAccess> {
    const version = await this.required().versionForAccess(customerId, documentId, versionId);
    if (!version) throw missing();
    if (!this.storage) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'This document is temporarily unavailable.', 503);
    try {
      const url = await this.storage.signedUrl(version.path, this.config.DOCUMENT_SIGNED_URL_TTL_SECONDS, download);
      await this.required().auditAccess(customerId, documentId, download);
      return { url, expiresInSeconds: this.config.DOCUMENT_SIGNED_URL_TTL_SECONDS };
    } catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'This document is temporarily unavailable.', 503); }
  }
}
