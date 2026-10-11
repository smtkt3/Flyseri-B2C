import type { FlightSearchRequest } from './index.js';

export interface FareWatch {
  id: string;
  search: FlightSearchRequest;
  targetAmount: number;
  currency: string;
  active: boolean;
  lastAmount: number | null;
  checkedAt: string | null;
  matchedAt: string | null;
  checkError: boolean;
}
export type SupportStage = 'QUEUED' | 'REVIEWING' | 'QUOTE_READY' | 'APPROVED' | 'IN_PROGRESS' | 'COMPLETED' | 'CANCELLED';
export interface SupportUpdate { stage: SupportStage; message: string; at: string; author: 'TEAM' | 'CUSTOMER' }
export interface TravelSupportRequest {
  id: string;
  version: number;
  conversationId: string;
  reason: string;
  stage: SupportStage;
  quote: { amount: number; currency: string; description: string; expiresAt: string } | null;
  updates: SupportUpdate[];
  createdAt: string;
  updatedAt: string;
}
