import type { CustomerProfile } from '@flyseri/types';
import { apiClient } from '../lib/api/client';

export const customerService = {
  async me(): Promise<CustomerProfile> { return (await apiClient.get<CustomerProfile>('/me')).data; },
  async update(patch: Partial<CustomerProfile>): Promise<CustomerProfile> { return (await apiClient.patch<CustomerProfile>('/me', patch)).data; },
};
