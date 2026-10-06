import { BadRequestException, Body, Controller, Get, HttpCode, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { IsUUID } from 'class-validator';
import type { ApiSuccess, OrderDetail, OrderReceipt, OrderSummary, PaymentStartResult, PaymentSummary } from '@flyseri/types';
import { CurrentUser, CustomerAuthGuard } from '../customer/auth.js';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { CommerceService } from './commerce.service.js';
import { PaymentEngineService } from './payment-engine.service.js';

class CreateFlightOrderDto { @IsUUID() bookingIntentId!: string; }
class StartPaymentDto { @IsUUID() idempotencyKey!: string; }
const validated = new ValidationPipe({ expectedType: CreateFlightOrderDto, transform: true, whitelist: true,
  forbidNonWhitelisted: true, exceptionFactory: () => new BadRequestException('Choose a valid flight selection.') });
const validatedPayment = new ValidationPipe({ expectedType: StartPaymentDto, transform: true, whitelist: true,
  forbidNonWhitelisted: true, exceptionFactory: () => new BadRequestException('Check the payment request.') });
const response = <T>(request: ContextRequest, data: T): ApiSuccess<T> => ({ success: true, data, requestId: request.requestId });

@Controller()
@UseGuards(CustomerAuthGuard)
export class CommerceController {
  constructor(@Inject(CommerceService) private readonly service: CommerceService,
    @Inject(PaymentEngineService) private readonly paymentsEngine: PaymentEngineService) {}
  @Post('orders/flight') @HttpCode(201)
  async create(@CurrentUser() user: AuthenticatedUserContext, @Body(validated) body: CreateFlightOrderDto,
    @Req() request: ContextRequest): Promise<ApiSuccess<OrderDetail>> {
    return response(request, await this.service.createFlightOrder(user.customerId, body.bookingIntentId, request.requestId));
  }
  @Post('visa-assistance-requests/:id/order') @HttpCode(201)
  async createAssistanceOrder(@CurrentUser() user: AuthenticatedUserContext, @Param('id', ParseUUIDPipe) id: string, @Req() request: ContextRequest) {
    return response(request, await this.service.createAssistanceOrder(user.customerId, id, request.requestId));
  }
  @Post('visa-applications/:applicationId/order') @HttpCode(201)
  async createVisaOrder(@CurrentUser() user: AuthenticatedUserContext, @Param('applicationId', ParseUUIDPipe) id: string,
    @Req() request: ContextRequest): Promise<ApiSuccess<OrderDetail>> {
    return response(request, await this.service.createVisaOrder(user.customerId, id, request.requestId));
  }
  @Get('orders')
  async list(@CurrentUser() user: AuthenticatedUserContext, @Req() request: ContextRequest): Promise<ApiSuccess<OrderSummary[]>> {
    return response(request, await this.service.list(user.customerId));
  }
  @Get('orders/:orderId')
  async detail(@CurrentUser() user: AuthenticatedUserContext, @Param('orderId', ParseUUIDPipe) id: string,
    @Req() request: ContextRequest): Promise<ApiSuccess<OrderDetail>> {
    return response(request, await this.service.detail(user.customerId, id));
  }
  @Get('orders/:orderId/receipt')
  async receipt(@CurrentUser() user: AuthenticatedUserContext, @Param('orderId', ParseUUIDPipe) id: string,
    @Req() request: ContextRequest): Promise<ApiSuccess<OrderReceipt>> {
    return response(request, await this.service.receipt(user.customerId, id));
  }
  @Post('orders/:orderId/payments')
  async startPayment(@CurrentUser() user: AuthenticatedUserContext, @Param('orderId', ParseUUIDPipe) id: string,
    @Body(validatedPayment) body: StartPaymentDto, @Req() request: ContextRequest): Promise<ApiSuccess<PaymentStartResult>> {
    // Check ownership before explaining that the provider is unavailable.
    await this.service.detail(user.customerId, id);
    return response(request, await this.paymentsEngine.start(user.customerId, id, body.idempotencyKey));
  }
  @Get('payments')
  async payments(@CurrentUser() user: AuthenticatedUserContext, @Req() request: ContextRequest): Promise<ApiSuccess<PaymentSummary[]>> {
    return response(request, await this.service.payments(user.customerId));
  }
  @Get('payments/capabilities')
  capabilities(@Req() request: ContextRequest): ApiSuccess<{ checkoutAvailable: boolean }> {
    return response(request, { checkoutAvailable: this.paymentsEngine.available() });
  }
  @Get('payments/:paymentId')
  async payment(@CurrentUser() user: AuthenticatedUserContext, @Param('paymentId', ParseUUIDPipe) id: string,
    @Req() request: ContextRequest): Promise<ApiSuccess<PaymentSummary>> {
    const current = await this.service.payment(user.customerId, id);
    if (['PENDING', 'PROCESSING', 'UNKNOWN'].includes(current.status) && this.paymentsEngine.available()) {
      try { await this.paymentsEngine.reconcile(id); } catch { /* A provider outage leaves the payment pending. */ }
    }
    return response(request, await this.service.payment(user.customerId, id));
  }
}

@Controller('payments/webhooks')
export class PaymentWebhookController {
  constructor(@Inject(PaymentEngineService) private readonly paymentsEngine: PaymentEngineService) {}
  @Post('stripe') @HttpCode(200)
  async stripe(@Req() request: ContextRequest & { rawBody?: Buffer }): Promise<{ received: true }> {
    await this.paymentsEngine.handleWebhook(request.rawBody, request.headers, request.requestId);
    return { received: true };
  }
}
