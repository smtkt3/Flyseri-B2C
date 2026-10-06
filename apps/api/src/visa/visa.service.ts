import { Inject, Injectable } from '@nestjs/common';
import type { VisaApplicationDetail, VisaApplicationSummary, VisaAssistanceRequestInput, VisaAssistanceRequestSummary, VisaType } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { VISA_STORE } from '../tokens.js';
import type { VisaStore } from './visa.repository.js';
import { VisaConflictError, VisaValidationError } from './visa.errors.js';

const missing = () => new ApiException('NOT_FOUND', 'The requested visa application was not found.', 404);
function map(error: unknown): never {
  if (error instanceof VisaValidationError) throw new ApiException('VALIDATION_ERROR', error.message, 400);
  if (error instanceof VisaConflictError || (typeof error === 'object' && error !== null && 'code' in error && error.code === '23505')) throw new ApiException('CONFLICT', 'This action is not available for the application.', 409);
  throw error;
}
@Injectable()
export class VisaService {
  constructor(@Inject(VISA_STORE) private readonly store: VisaStore | undefined) {}
  private required(): VisaStore { if (!this.store) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Visa applications are temporarily unavailable.', 503); return this.store; }
  catalogue(countryCode: string): Promise<VisaType[]> { return this.required().catalogue(countryCode); }
  async types(customerId: string, tripId: string): Promise<VisaType[]> { return await this.required().types(customerId, tripId) ?? Promise.reject(missing()); }
  list(customerId: string, tripId?: string): Promise<VisaApplicationSummary[]> { return this.required().list(customerId, tripId); }
  async detail(customerId: string, id: string): Promise<VisaApplicationDetail> { return await this.required().detail(customerId, id) ?? Promise.reject(missing()); }
  async create(customerId: string, tripId: string, visaTypeId: string, travellerIds: string[]): Promise<VisaApplicationDetail> {
    try { return await this.required().create(customerId, tripId, visaTypeId, travellerIds) ?? Promise.reject(missing()); } catch (error) { return map(error); }
  }
  async createAssistanceRequest(customerId: string, input: VisaAssistanceRequestInput): Promise<VisaAssistanceRequestSummary> {
    try { return await this.required().createAssistanceRequest(customerId, input); } catch (error) { return map(error); }
  }
  assistanceList(customerId: string) { return this.required().assistanceList(customerId); }
  async saveAssistanceForm(customerId: string, id: string, input: VisaAssistanceRequestInput) {
    try { return await this.required().saveAssistanceForm(customerId, id, input) ?? Promise.reject(missing()); } catch (error) { return map(error); }
  }
  async assistanceDetail(customerId: string, id: string) { return await this.required().assistanceDetail(customerId, id) ?? Promise.reject(missing()); }
  async assistanceAction(customerId: string, id: string, action: 'LINK' | 'UNLINK' | 'SUBMIT' | 'NOTE', input = {}) {
    try { return await this.required().assistanceAction(customerId, id, action, input) ?? Promise.reject(missing()); } catch (error) { return map(error); }
  }
  async action(customerId: string, id: string, action: 'MARK_INCOMPLETE' | 'SUBMIT_DOCUMENTS'): Promise<VisaApplicationDetail> {
    try { return await this.required().action(customerId, id, action) ?? Promise.reject(missing()); } catch (error) { return map(error); }
  }
  async saveAnswers(customerId: string, id: string, scope: string, answers: Record<string, unknown>): Promise<VisaApplicationDetail> {
    try { return await this.required().saveAnswers(customerId, id, scope, answers) ?? Promise.reject(missing()); } catch (error) { return map(error); }
  }
  async submit(customerId: string, id: string, declarationVersion: string): Promise<VisaApplicationDetail> {
    try { return await this.required().submit(customerId, id, declarationVersion) ?? Promise.reject(missing()); } catch (error) { return map(error); }
  }
  async archive(customerId: string, id: string): Promise<{ archived: true }> {
    try { if (!await this.required().archive(customerId, id)) throw missing(); return { archived: true }; } catch (error) { return map(error); }
  }
  async link(customerId: string, id: string, requirementId: string, documentId: string, versionId: string): Promise<VisaApplicationDetail> {
    try { return await this.required().link(customerId, id, requirementId, documentId, versionId) ?? Promise.reject(missing()); } catch (error) { return map(error); }
  }
  async unlink(customerId: string, id: string, requirementId: string, documentId: string): Promise<VisaApplicationDetail> {
    try { return await this.required().unlink(customerId, id, requirementId, documentId) ?? Promise.reject(missing()); } catch (error) { return map(error); }
  }
}
