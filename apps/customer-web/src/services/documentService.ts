import type { DocumentAccess, DocumentDetail, DocumentInput, DocumentSummary, DocumentType } from '@flyseri/types';
import { apiClient } from '../lib/api/client';

const base = '/documents';
export const documentService = {
  async list(filter: { travellerId?: string; documentType?: DocumentType; status?: string } = {}): Promise<DocumentSummary[]> {
    const search = new URLSearchParams(Object.entries(filter).filter(([, value]) => !!value) as [string, string][]);
    return (await apiClient.get<DocumentSummary[]>(`${base}${search.size ? `?${search}` : ''}`)).data;
  },
  async policy(): Promise<{ maxUploadMb: number; acceptedTypes: string[] }> { return (await apiClient.get<{ maxUploadMb: number; acceptedTypes: string[] }>(`${base}/upload-policy`)).data; },
  async detail(id: string): Promise<DocumentDetail> { return (await apiClient.get<DocumentDetail>(`${base}/${encodeURIComponent(id)}`)).data; },
  async create(input: DocumentInput): Promise<DocumentDetail> { return (await apiClient.post<DocumentDetail>(base, input)).data; },
  async update(id: string, patch: Partial<DocumentInput>): Promise<DocumentDetail> { return (await apiClient.patch<DocumentDetail>(`${base}/${encodeURIComponent(id)}`, patch)).data; },
  async archive(id: string): Promise<void> { await apiClient.delete(`${base}/${encodeURIComponent(id)}`); },
  async upload(id: string, file: File, idempotencyKey: string): Promise<DocumentDetail> {
    const form = new FormData(); form.append('file', file);
    return (await apiClient.post<DocumentDetail>(`${base}/${encodeURIComponent(id)}/versions`, form, { headers: { 'Idempotency-Key': idempotencyKey }, timeoutMs: 90_000 })).data;
  },
  async access(id: string, versionId?: string, download = false): Promise<DocumentAccess> {
    const path = versionId ? `${base}/${encodeURIComponent(id)}/versions/${encodeURIComponent(versionId)}/access-url` : `${base}/${encodeURIComponent(id)}/access-url`;
    return (await apiClient.get<DocumentAccess>(`${path}?download=${download}`)).data;
  },
};
