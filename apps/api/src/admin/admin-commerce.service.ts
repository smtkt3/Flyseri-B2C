import { Inject, Injectable } from '@nestjs/common';
import { and, count, desc, eq, ilike, type SQL } from 'drizzle-orm';
import { customers, orderItems, orders, payments, type DatabaseConnection } from '@flyseri/database';
import { ApiException } from '../api-exception.js';
import { DATABASE_CONNECTION } from '../tokens.js';
import { presentOrder, presentPayment } from '../commerce/commerce.repository.js';
import type { AdminListQuery } from './admin-records.service.js';

const unavailable = () => new ApiException('DEPENDENCY_UNAVAILABLE', 'Flyseri data is unavailable.', 503);
const missing = () => new ApiException('NOT_FOUND', 'Record not found.', 404);
@Injectable()
export class AdminCommerceService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined) {}
  private get db() { if (!this.connection) throw unavailable(); return this.connection.db; }
  async orders(query: AdminListQuery) {
    const filters: SQL[] = [];
    if (query.customerId) filters.push(eq(orders.customerId, query.customerId));
    if (query.tripId) filters.push(eq(orders.tripId, query.tripId));
    if (query.status) filters.push(eq(orders.status, query.status));
    if (query.search) filters.push(ilike(orders.orderNumber, `%${query.search}%`));
    const where = filters.length ? and(...filters) : undefined;
    const [rows, total] = await Promise.all([
      this.db.select({ order: orders, customerName: customers.displayName }).from(orders)
        .innerJoin(customers, eq(orders.customerId, customers.id)).where(where)
        .orderBy(desc(orders.createdAt), desc(orders.id)).limit(query.limit).offset((query.page - 1) * query.limit),
      this.db.select({ count: count() }).from(orders).where(where),
    ]);
    return { items: rows.map((row) => ({ ...presentOrder(row.order), customerId: row.order.customerId,
      customerName: row.customerName })), total: total[0]?.count ?? 0, page: query.page, limit: query.limit };
  }
  async order(id: string) {
    const [row] = await this.db.select({ order: orders, customerName: customers.displayName }).from(orders)
      .innerJoin(customers, eq(orders.customerId, customers.id)).where(eq(orders.id, id)).limit(1);
    if (!row) throw missing();
    const [items, paymentRows] = await Promise.all([
      this.db.select({ description: orderItems.descriptionSnapshot, itemType: orderItems.itemType,
        quantity: orderItems.quantity, totalAmount: orderItems.totalAmount, currency: orderItems.currency })
        .from(orderItems).where(eq(orderItems.orderId, id)),
      this.db.select().from(payments).where(eq(payments.orderId, id)).limit(1),
    ]);
    return { ...presentOrder(row.order), customerId: row.order.customerId, customerName: row.customerName,
      items, payment: paymentRows[0] ? presentPayment(paymentRows[0]) : null };
  }
  async payments(query: AdminListQuery) {
    const filters: SQL[] = [];
    if (query.customerId) filters.push(eq(payments.customerId, query.customerId));
    if (query.status) filters.push(eq(payments.status, query.status));
    const where = filters.length ? and(...filters) : undefined;
    const [rows, total] = await Promise.all([
      this.db.select({ payment: payments, orderNumber: orders.orderNumber, customerName: customers.displayName })
        .from(payments).innerJoin(orders, eq(payments.orderId, orders.id))
        .innerJoin(customers, eq(payments.customerId, customers.id)).where(where)
        .orderBy(desc(payments.createdAt), desc(payments.id)).limit(query.limit).offset((query.page - 1) * query.limit),
      this.db.select({ count: count() }).from(payments).where(where),
    ]);
    return { items: rows.map((row) => ({ ...presentPayment(row.payment), orderNumber: row.orderNumber,
      customerId: row.payment.customerId, customerName: row.customerName })),
      total: total[0]?.count ?? 0, page: query.page, limit: query.limit };
  }
  async payment(id: string) {
    const [row] = await this.db.select({ payment: payments, orderNumber: orders.orderNumber,
      customerName: customers.displayName }).from(payments).innerJoin(orders, eq(payments.orderId, orders.id))
      .innerJoin(customers, eq(payments.customerId, customers.id)).where(eq(payments.id, id)).limit(1);
    if (!row) throw missing();
    return { ...presentPayment(row.payment), orderNumber: row.orderNumber, customerId: row.payment.customerId,
      customerName: row.customerName, provider: row.payment.provider,
      providerReference: row.payment.providerReference, lastReconciledAt: row.payment.lastReconciledAt?.toISOString() ?? null };
  }
}
