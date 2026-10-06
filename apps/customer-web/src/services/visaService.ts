import type { VisaApplicationDetail, VisaApplicationSummary, VisaAssistanceRequestDetail, VisaAssistanceRequestInput, VisaAssistanceRequestSummary, VisaType } from '@flyseri/types';
import { apiClient } from '../lib/api/client';

export const visaService = {
  async catalogue(countryCode: string): Promise<VisaType[]> { return (await apiClient.get<VisaType[]>(`/visa-services?countryCode=${encodeURIComponent(countryCode)}`)).data; },
  async createAssistanceRequest(input: VisaAssistanceRequestInput): Promise<VisaAssistanceRequestSummary> {
    return (await apiClient.post<VisaAssistanceRequestSummary>('/visa-assistance-requests', input)).data;
  },
  async assistanceList(): Promise<VisaAssistanceRequestSummary[]> { return (await apiClient.get<VisaAssistanceRequestSummary[]>('/visa-assistance-requests')).data; },
  async assistanceSaveForm(id: string, input: VisaAssistanceRequestInput): Promise<VisaAssistanceRequestDetail> { return (await apiClient.patch<VisaAssistanceRequestDetail>('/visa-assistance-requests/' + encodeURIComponent(id) + '/form', input)).data; },
  async assistanceDetail(id: string): Promise<VisaAssistanceRequestDetail> { return (await apiClient.get<VisaAssistanceRequestDetail>('/visa-assistance-requests/' + encodeURIComponent(id))).data; },
  async assistanceLink(id: string, travellerId: string, documentId: string, documentVersionId: string): Promise<VisaAssistanceRequestDetail> { return (await apiClient.post<VisaAssistanceRequestDetail>('/visa-assistance-requests/' + encodeURIComponent(id) + '/applicants/' + encodeURIComponent(travellerId) + '/documents', { documentId, documentVersionId })).data; },
  async assistanceUnlink(id: string, linkId: string): Promise<VisaAssistanceRequestDetail> { return (await apiClient.delete<VisaAssistanceRequestDetail>('/visa-assistance-requests/' + encodeURIComponent(id) + '/documents/' + encodeURIComponent(linkId))).data; },
  async assistanceSaveNote(id: string, customerMessage: string): Promise<VisaAssistanceRequestDetail> { return (await apiClient.patch<VisaAssistanceRequestDetail>('/visa-assistance-requests/' + encodeURIComponent(id) + '/note', {customerMessage})).data; },
  async assistanceSubmit(id: string, customerMessage?: string): Promise<VisaAssistanceRequestDetail> { return (await apiClient.post<VisaAssistanceRequestDetail>('/visa-assistance-requests/' + encodeURIComponent(id) + '/submit', customerMessage === undefined ? {} : {customerMessage})).data; },
  async types(tripId: string): Promise<VisaType[]> { return (await apiClient.get<VisaType[]>(`/trips/${encodeURIComponent(tripId)}/visa-types`)).data; },
  async list(tripId?: string): Promise<VisaApplicationSummary[]> { return (await apiClient.get<VisaApplicationSummary[]>(tripId ? `/visa-applications?tripId=${encodeURIComponent(tripId)}` : '/visa-applications')).data; },
  async detail(id: string): Promise<VisaApplicationDetail> { return (await apiClient.get<VisaApplicationDetail>(`/visa-applications/${encodeURIComponent(id)}`)).data; },
  async create(tripId: string, visaTypeId: string, travellerIds: string[]): Promise<VisaApplicationDetail> { return (await apiClient.post<VisaApplicationDetail>(`/trips/${encodeURIComponent(tripId)}/visa-applications`, { visaTypeId, travellerIds })).data; },
  async action(id: string, action: 'MARK_INCOMPLETE' | 'SUBMIT_DOCUMENTS'): Promise<VisaApplicationDetail> { return (await apiClient.patch<VisaApplicationDetail>(`/visa-applications/${encodeURIComponent(id)}`, { action })).data; },
  async saveAnswers(id: string, scope: string, answers: Record<string, unknown>): Promise<VisaApplicationDetail> {
    return (await apiClient.patch<VisaApplicationDetail>(`/visa-applications/${encodeURIComponent(id)}/answers`, { scope, answers })).data;
  },
  async submit(id: string): Promise<VisaApplicationDetail> {
    return (await apiClient.post<VisaApplicationDetail>(`/visa-applications/${encodeURIComponent(id)}/submit`, { declarationVersion: 'FLYSERI_VISA_DECLARATION_V1' })).data;
  },
  async archive(id: string): Promise<void> { await apiClient.delete(`/visa-applications/${encodeURIComponent(id)}`); },
  async link(id: string, requirementId: string, documentId: string, documentVersionId: string): Promise<VisaApplicationDetail> { return (await apiClient.post<VisaApplicationDetail>(`/visa-applications/${encodeURIComponent(id)}/requirements/${encodeURIComponent(requirementId)}/documents`, { documentId, documentVersionId })).data; },
  async unlink(id: string, requirementId: string, documentId: string): Promise<VisaApplicationDetail> { return (await apiClient.delete<VisaApplicationDetail>(`/visa-applications/${encodeURIComponent(id)}/requirements/${encodeURIComponent(requirementId)}/documents/${encodeURIComponent(documentId)}`)).data; },
};
