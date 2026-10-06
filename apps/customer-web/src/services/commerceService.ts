import type { OrderDetail, OrderReceipt, OrderSummary, PaymentStartResult, PaymentSummary } from '@flyseri/types';
import { apiClient } from '../lib/api/client';

export const commerceService = {
  async createFlightOrder(bookingIntentId: string): Promise<OrderDetail> {
    return (await apiClient.post<OrderDetail>('/orders/flight', { bookingIntentId })).data;
  },
  async createAssistanceOrder(requestId: string): Promise<OrderDetail> {
    return (await apiClient.post<OrderDetail>(`/visa-assistance-requests/${encodeURIComponent(requestId)}/order`, {})).data;
  },
  async createVisaOrder(applicationId: string): Promise<OrderDetail> {
    return (await apiClient.post<OrderDetail>(`/visa-applications/${encodeURIComponent(applicationId)}/order`, {})).data;
  },
  async orders(): Promise<OrderSummary[]> { return (await apiClient.get<OrderSummary[]>('/orders')).data; },
  async order(id: string): Promise<OrderDetail> { return (await apiClient.get<OrderDetail>(`/orders/${encodeURIComponent(id)}`)).data; },
  async payments(): Promise<PaymentSummary[]> { return (await apiClient.get<PaymentSummary[]>('/payments')).data; },
  async paymentCapabilities(): Promise<{ checkoutAvailable: boolean }> {
    return (await apiClient.get<{ checkoutAvailable: boolean }>('/payments/capabilities')).data;
  },
  async startPayment(orderId: string, idempotencyKey: string): Promise<PaymentStartResult> {
    return (await apiClient.post<PaymentStartResult>(`/orders/${encodeURIComponent(orderId)}/payments`, { idempotencyKey })).data;
  },
  async payment(id: string): Promise<PaymentSummary> { return (await apiClient.get<PaymentSummary>(`/payments/${encodeURIComponent(id)}`)).data; },
  async receipt(id: string): Promise<OrderReceipt> { return (await apiClient.get<OrderReceipt>(`/orders/${encodeURIComponent(id)}/receipt`)).data; },
};
