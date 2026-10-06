import { Inject, Injectable } from '@nestjs/common';
import type { OrderDetail, OrderReceipt, OrderSummary, PaymentSummary } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { COMMERCE_REPOSITORY } from '../tokens.js';
import { CommerceRepository, OrderConflictError, OrderUnavailableError } from './commerce.repository.js';

const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'Orders are temporarily unavailable. Please try again later.', 503);
const missing = () => new ApiException('NOT_FOUND', 'We could not find that order.', 404);

@Injectable()
export class CommerceService {
  constructor(@Inject(COMMERCE_REPOSITORY) private readonly repository: CommerceRepository | undefined) {}
  async createFlightOrder(customerId: string, bookingIntentId: string, requestId: string): Promise<OrderDetail> {
    if (!this.repository) throw unavailable();
    try { return await this.repository.createFlightOrder(customerId, bookingIntentId, requestId); }
    catch (error) {
      if (error instanceof OrderUnavailableError) throw new ApiException('NOT_FOUND', 'We could not find that flight selection.', 404);
      if (error instanceof OrderConflictError) throw new ApiException('CONFLICT', 'Confirm the current fare and review selected airline extras before creating a payment order.', 409);
      throw error;
    }
  }
  async createAssistanceOrder(customerId: string, id: string, requestId: string): Promise<OrderDetail> {
    if (!this.repository) throw unavailable();
    try { return await this.repository.createAssistanceOrder(customerId, id, requestId); }
    catch (error) {
      if (error instanceof OrderUnavailableError) throw new ApiException('NOT_FOUND', 'We could not find that visa request.', 404);
      if (error instanceof OrderConflictError) throw new ApiException('CONFLICT', 'Complete applicant details and confirm the configured service fee before payment.', 409);
      throw error;
    }
  }
  async createVisaOrder(customerId: string, applicationId: string, requestId: string): Promise<OrderDetail> {
    if (!this.repository) throw unavailable();
    try { return await this.repository.createVisaOrder(customerId, applicationId, requestId); }
    catch (error) {
      if (error instanceof OrderUnavailableError) throw new ApiException('NOT_FOUND', 'We could not find that visa application.', 404);
      if (error instanceof OrderConflictError) throw new ApiException('CONFLICT', 'The visa application is not ready for payment or its fee is not configured.', 409);
      throw error;
    }
  }
  async list(customerId: string): Promise<OrderSummary[]> { if (!this.repository) throw unavailable(); return this.repository.list(customerId); }
  async detail(customerId: string, orderId: string): Promise<OrderDetail> {
    if (!this.repository) throw unavailable();
    return await this.repository.detail(customerId, orderId) ?? Promise.reject(missing());
  }
  async payments(customerId: string): Promise<PaymentSummary[]> { if (!this.repository) throw unavailable(); return this.repository.payments(customerId); }
  async payment(customerId: string, paymentId: string): Promise<PaymentSummary> {
    if (!this.repository) throw unavailable();
    const result = await this.repository.payment(customerId, paymentId);
    if (!result) throw new ApiException('NOT_FOUND', 'We could not find that payment.', 404);
    return result;
  }
  async receipt(customerId: string, orderId: string): Promise<OrderReceipt> {
    const order = await this.detail(customerId, orderId);
    if (order.status !== 'PAID' || order.payment?.status !== 'SUCCEEDED' || !order.paidAt) {
      throw new ApiException('CONFLICT', 'A receipt is available after payment is confirmed.', 409);
    }
    return { orderNumber: order.orderNumber, paidAt: order.paidAt, currency: order.currency,
      totalAmount: order.totalAmount, items: order.items, documentKind: 'PAYMENT_RECEIPT' };
  }
}
