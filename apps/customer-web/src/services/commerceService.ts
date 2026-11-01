import type { OrderDetail, OrderReceipt, OrderSummary, PaymentStartResult, PaymentSummary } from '@flyseri/types';
import { apiClient } from '../lib/api/client';

export const commerceService = {
  async createFlightOrder(bookingIntentId: string): Promise<OrderDetail> {
    return (await apiClient.post<OrderDetail>('/orders/flight', { bookingIntentId }, {timeoutMs:20000})).data;
  },
  async createAssistanceOrder(requestId: string): Promise<OrderDetail> {
    return (await apiClient.post<OrderDetail>(`/visa-assistance-requests/${encodeURIComponent(requestId)}/order`, {})).data;
  },
  async createVisaOrder(applicationId: string): Promise<OrderDetail> {
    return (await apiClient.post<OrderDetail>(`/visa-applications/${encodeURIComponent(applicationId)}/order`, {})).data;
  },
  async orders(): Promise<OrderSummary[]> { return (await apiClient.get<OrderSummary[]>('/orders')).data; },
  async order(id: string): Promise<OrderDetail> { return (await apiClient.get<OrderDetail>(`/orders/${encodeURIComponent(id)}`,{timeoutMs:20000})).data; },
  async payments(): Promise<PaymentSummary[]> { return (await apiClient.get<PaymentSummary[]>('/payments')).data; },
  async paymentCapabilities(): Promise<{ checkoutAvailable: boolean }> {
    return (await apiClient.get<{ checkoutAvailable: boolean }>('/payments/capabilities')).data;
  },
  async startPayment(orderId: string, idempotencyKey: string): Promise<PaymentStartResult> {
    // This request includes Sabre PNR/fare verification and Stripe session
    // creation/resume. The general 8-second API budget aborts a valid checkout.
    return (await apiClient.post<PaymentStartResult>(`/orders/${encodeURIComponent(orderId)}/payments`, { idempotencyKey }, {timeoutMs:90000})).data;
  },
  async payment(id: string): Promise<PaymentSummary> { return (await apiClient.get<PaymentSummary>(`/payments/${encodeURIComponent(id)}`,{timeoutMs:30000})).data; },
  async receipt(id: string): Promise<OrderReceipt> { return (await apiClient.get<OrderReceipt>(`/orders/${encodeURIComponent(id)}/receipt`)).data; },
};
