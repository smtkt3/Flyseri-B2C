import type { PointsQuote, PointsWallet } from '@flyseri/types';
import { apiClient } from '../lib/api/client';
export const pointsService={
  async wallet(page=1) {return (await apiClient.get<PointsWallet>(`/points?page=${page}`)).data;},
  async quote(orderId:string) {return (await apiClient.get<PointsQuote>(`/points/orders/${encodeURIComponent(orderId)}`)).data;},
  async apply(orderId:string,points:number) {return (await apiClient.post<PointsQuote>(`/points/orders/${encodeURIComponent(orderId)}`,{points})).data;},
};
