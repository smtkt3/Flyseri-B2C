import type { TravellerProfile, TravellerPassport } from '@flyseri/types';
import { apiClient } from '../lib/api/client';

export type TravellerForm = Pick<TravellerProfile, 'legalFirstName' | 'legalLastName' | 'relationshipType'> &
  Partial<Pick<TravellerProfile, 'legalMiddleName' | 'dateOfBirth' | 'gender' | 'nationalityCountryCode' | 'saveForFuture'>>;

export const travellerService = {
  async get(id:string):Promise<TravellerProfile>{return (await apiClient.get<TravellerProfile>(`/travellers/${encodeURIComponent(id)}`)).data;},
  async passport(id:string):Promise<TravellerPassport|null>{return (await apiClient.get<TravellerPassport|null>(`/travellers/${encodeURIComponent(id)}/passport`)).data;},
  async savePassport(id:string,passport:TravellerPassport):Promise<void>{await apiClient.post(`/travellers/${encodeURIComponent(id)}/passport`,{...passport,saveForFuture:true});},
  async removePassport(id:string):Promise<void>{await apiClient.delete(`/travellers/${encodeURIComponent(id)}/passport`);},
  async list(): Promise<TravellerProfile[]> { return (await apiClient.get<TravellerProfile[]>('/travellers')).data; },
  async create(input: TravellerForm): Promise<TravellerProfile> { return (await apiClient.post<TravellerProfile>('/travellers', input)).data; },
  async update(id: string, input: Partial<TravellerForm>): Promise<TravellerProfile> { return (await apiClient.patch<TravellerProfile>(`/travellers/${encodeURIComponent(id)}`, input)).data; },
  async archive(id: string): Promise<void> { await apiClient.delete(`/travellers/${encodeURIComponent(id)}`); },
};
