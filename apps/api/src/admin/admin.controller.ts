import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { Transform } from 'class-transformer';
import { ArrayMaxSize, IsArray, IsBoolean, IsIn, IsInt, IsISO8601, IsObject, IsOptional, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';
import { Type } from 'class-transformer';
import type { ApiSuccess } from '@flyseri/types';
import type { AppConfig } from '@flyseri/config';
import type { ContextRequest } from '../request-context.js';
import { APP_CONFIG, FLIGHT_TELEMETRY, REDIS_STORE } from '../tokens.js';
import type { RedisStore } from '@flyseri/redis';
import { FlightTelemetry } from '../flight/flight.telemetry.js';
import { AdminAuthGuard, CurrentStaff, RequireAdminPermission, type AdminIdentity } from './admin-auth.js';
import { AdminDashboardService } from './admin-dashboard.service.js';
import { AdminRecordsService } from './admin-records.service.js';
import { AdminDocumentsService } from './admin-documents.service.js';
import { AdminFlightsService } from './admin-flights.service.js';
import { AdminCommerceService } from './admin-commerce.service.js';
import { AdminCrmService } from './admin-crm.service.js';
import { AdminVisaService, type VisaStaffStatus, type VisaServiceVersionInput } from './admin-visa.service.js';

class CrmLinkBody { @IsUUID() crmContactId!: string; @IsString() @Matches(/^\d{10}\.[0-9a-f]{64}$/) contactProof!: string; }

class ListQuery {
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) page = 1;
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(50) limit = 20;
  @IsOptional() @IsString() @MaxLength(100) search?: string;
  @IsOptional() @IsString() @Matches(/^[A-Z_]{1,40}$/) status?: string;
  @IsOptional() @IsUUID() customerId?: string;
  @IsOptional() @IsUUID() tripId?: string;
  @IsOptional() @IsIn(['CREATED', 'PENDING', 'PROCESSING', 'UNKNOWN', 'SUCCEEDED', 'FAILED', 'CANCELLED', 'EXPIRED']) paymentStatus?: string;
  @IsOptional() @IsISO8601() createdFrom?: string;
  @IsOptional() @IsISO8601() createdTo?: string;
  @IsOptional() @Transform(({ value }) => value === 'true' ? true : value === 'false' ? false : value) @IsBoolean() actionRequired?: boolean;
}
const validateListQuery = new ValidationPipe({ expectedType: ListQuery, transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: () => new BadRequestException('The request is invalid.') });
class VisaServiceBody implements VisaServiceVersionInput {
  @IsOptional() @IsString() @MaxLength(500) description?: string | null;
  @IsOptional() @IsString() @MaxLength(240) processingTimeText?: string | null;
  @IsOptional() @IsString() @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) governmentFeeAmount?: string | null;
  @IsOptional() @IsString() @Matches(/^\d{1,10}(?:\.\d{1,2})?$/) serviceFeeAmount?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) otherFeeComponents?: Array<{ code: string; label: string; amount: string }>;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string | null;
  @IsOptional() @IsString() @MaxLength(240) validityText?: string | null;
  @IsOptional() @IsString() @MaxLength(24) entryType?: string | null;
  @IsOptional() @IsString() @MaxLength(4000) notes?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(30) disclaimers?: string[];
  @IsOptional() @IsArray() @ArrayMaxSize(250) @Matches(/^[A-Z]{2}$/, { each: true }) nationalityEligibility?: string[];
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveUntil?: string | null;
  @IsObject() formDefinition!: unknown;
  @IsBoolean() published!: boolean;
}
class VisaRequirementBody {
  @Matches(/^[A-Z0-9_-]{2,64}$/) requirementCode!: string;
  @IsString() @MinLength(2) @MaxLength(160) name!: string;
  @IsOptional() @IsString() @MaxLength(1000) description?: string | null;
  @IsOptional() @IsString() @Matches(/^[A-Z_]{2,32}$/) documentTypeRequired?: string | null;
  @IsBoolean() required!: boolean;
  @IsInt() @Min(0) @Max(500) displayOrder!: number;
  @IsOptional() @Matches(/^[A-Z]{2}$/) nationalityCountryCode?: string | null;
  @IsOptional() @Matches(/^[A-Z]{2}$/) residenceCountryCode?: string | null;
  @IsOptional() @IsString() @MaxLength(32) applicantCategory?: string | null;
  @IsOptional() @IsInt() @Min(0) @Max(125) minAge?: number | null;
  @IsOptional() @IsInt() @Min(0) @Max(125) maxAge?: number | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveFrom?: string | null;
  @IsOptional() @Matches(/^\d{4}-\d{2}-\d{2}$/) effectiveUntil?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(20) conditions?: Array<{ field: string; operator: 'EQ' | 'NEQ' | 'IN'; value: string | string[] }>;
}
class CreateVisaServiceBody extends VisaServiceBody {
  @Matches(/^[A-Z]{2}$/) destinationCountryCode!: string;
  @Matches(/^[A-Z0-9_-]{2,64}$/) code!: string;
  @IsString() @MinLength(2) @MaxLength(120) name!: string;
}
class VisaStatusBody {
  @IsIn(['DOCUMENT_REVIEW','ADDITIONAL_DOCUMENTS_REQUIRED','ADDITIONAL_INFORMATION_REQUIRED','APPLICATION_PREPARATION',
    'READY_FOR_SUBMISSION_TO_AUTHORITY','SUBMITTED_TO_EMBASSY_OR_AUTHORITY','UNDER_PROCESSING','APPROVED','VISA_ISSUED','REJECTED','COMPLETED','CANCELLED'])
  status!: VisaStaffStatus;
  @IsOptional() @IsString() @MaxLength(500) customerMessage?: string;
  @IsOptional() @IsString() @MaxLength(2000) internalNote?: string;
}
class VisaRequirementReviewBody {
  @IsIn(['UNDER_REVIEW','ACCEPTED','REPLACEMENT_REQUIRED','NOT_APPLICABLE']) status!: 'UNDER_REVIEW' | 'ACCEPTED' | 'REPLACEMENT_REQUIRED' | 'NOT_APPLICABLE';
  @IsOptional() @IsString() @MaxLength(2000) reason?: string;
}
class VisaRequestBody {
  @IsIn(['DOCUMENT','ANSWER','ADDITIONAL_INFO']) requestType!: 'DOCUMENT' | 'ANSWER' | 'ADDITIONAL_INFO';
  @IsString() @MinLength(3) @MaxLength(2000) reason!: string;
  @IsOptional() @IsUUID() requirementId?: string;
  @IsOptional() @IsUUID() travellerId?: string;
  @IsOptional() @IsString() @Matches(/^[a-z][a-z0-9_.-]{0,79}$/) fieldKey?: string;
  @IsOptional() @IsISO8601() dueAt?: string;
}
class VisaNoteBody {
  @IsIn(['INTERNAL','CUSTOMER']) visibility!: 'INTERNAL' | 'CUSTOMER';
  @IsString() @MinLength(1) @MaxLength(4000) note!: string;
}
const response = <T>(request: ContextRequest, data: T): ApiSuccess<T> => ({ success: true, data, requestId: request.requestId });

class AssistanceFeeBody {
  @IsString() @Matches(/^(?:0|[1-9][0-9]{0,6})(?:\.[0-9]{1,2})?$/) amount!: string;
  @IsIn(['MYR','USD','SGD','EUR','GBP','AUD']) currency!: string;
  @IsIn(['APPLICATION','APPLICANT']) basis!: string;
  @IsBoolean() active!: boolean;
}
@Controller('admin')
@UseGuards(AdminAuthGuard)
export class AdminController {
  constructor(@Inject(AdminDashboardService) private readonly dashboard: AdminDashboardService,
    @Inject(AdminRecordsService) private readonly records: AdminRecordsService,
    @Inject(AdminDocumentsService) private readonly documents: AdminDocumentsService,
    @Inject(AdminFlightsService) private readonly flights: AdminFlightsService,
    @Inject(AdminCommerceService) private readonly commerce: AdminCommerceService,
    @Inject(AdminCrmService) private readonly crm: AdminCrmService,
    @Inject(AdminVisaService) private readonly visaOperations: AdminVisaService,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(FLIGHT_TELEMETRY) private readonly flightTelemetry: FlightTelemetry,
    @Inject(REDIS_STORE) private readonly redis: RedisStore | undefined) {}

  @Get('flights/metrics') @RequireAdminPermission('flights')
  async flightMetrics(@Req() request: ContextRequest) {
    return response(request, { ...this.flightTelemetry.performanceSnapshot(),
      environment: this.config.SABRE_ENV, cacheTtlSeconds: this.config.SABRE_BFM_CACHE_TTL_SECONDS,
      backgroundWarming: this.config.SABRE_CACHE_WARMUP_ENABLED,
      cache: { mode: this.redis ? 'redis' : 'memory', healthy: this.redis ? await this.redis.health() : this.config.APP_ENV !== 'production' } });
  }

  @Get('dashboard/summary') @RequireAdminPermission('overview')
  async summary(@Req() request: ContextRequest) { return response(request, await this.dashboard.summary()); }

  @Get('ai/metrics') @RequireAdminPermission('ai_operations')
  async aiMetrics(@Req() request: ContextRequest) { return response(request, await this.dashboard.aiMetrics()); }

  @Get('customers') @RequireAdminPermission('customers')
  async customers(@Query() query: ListQuery, @Req() request: ContextRequest) { return response(request, await this.records.customers(query)); }
  @Get('customers/:id') @RequireAdminPermission('customers')
  async customer(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) { return response(request, await this.records.customer(id)); }
  @Get('customers/:id/activity') @RequireAdminPermission('customers')
  async customerActivity(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) {
    return response(request, await this.records.customerActivity(id));
  }
  @Get('customers/:id/crm-link') @RequireAdminPermission('customers')
  async customerCrmLink(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) {
    return response(request, await this.crm.linkForCustomer(id));
  }
  @Post('customers/:id/crm-link') @RequireAdminPermission('crm_links')
  async linkCustomer(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: CrmLinkBody,
    @CurrentStaff() staff: AdminIdentity, @Req() request: ContextRequest) {
    return response(request, await this.crm.link(id, body.crmContactId, body.contactProof, staff, request.requestId));
  }
  @Delete('customers/:id/crm-link') @RequireAdminPermission('crm_links')
  async unlinkCustomer(@Param('id', new ParseUUIDPipe()) id: string, @CurrentStaff() staff: AdminIdentity,
    @Req() request: ContextRequest) { return response(request, await this.crm.unlink(id, staff, request.requestId)); }
  @Get('crm-links/by-contact/:id') @RequireAdminPermission('customers')
  async contactCrmLink(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) {
    return response(request, await this.crm.linkForContact(id));
  }
  @Get('crm-sync/status') @RequireAdminPermission('crm_sync')
  async crmStatus(@Req() request: ContextRequest) { return response(request, await this.crm.status()); }
  @Get('crm-sync/failures') @RequireAdminPermission('crm_sync')
  async crmFailures(@Req() request: ContextRequest) { return response(request, await this.crm.failures()); }
  @Post('crm-sync/failures/:id/retry') @RequireAdminPermission('crm_sync')
  async retryCrm(@Param('id', new ParseUUIDPipe()) id: string, @CurrentStaff() staff: AdminIdentity,
    @Req() request: ContextRequest) { return response(request, await this.crm.retry(id, staff, request.requestId)); }

  @Get('travellers') @RequireAdminPermission('travellers')
  async travellers(@Query() query: ListQuery, @Req() request: ContextRequest) { return response(request, await this.records.travellers(query)); }
  @Get('travellers/:id') @RequireAdminPermission('travellers')
  async traveller(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) { return response(request, await this.records.traveller(id)); }

  @Get('trips') @RequireAdminPermission('trips')
  async trips(@Query() query: ListQuery, @Req() request: ContextRequest) { return response(request, await this.records.trips(query)); }
  @Get('trips/:id') @RequireAdminPermission('trips')
  async trip(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) { return response(request, await this.records.trip(id)); }

  @Get('visa') @RequireAdminPermission('visa')
  async visas(@Query(validateListQuery) query: ListQuery, @Req() request: ContextRequest) { return response(request, await this.records.visas(query)); }
  @Get('visa/assistance-fee') @RequireAdminPermission('visa_configure')
  async assistanceFee(@Req() request: ContextRequest) { return response(request, await this.visaOperations.assistanceFee()); }
  @Post('visa/assistance-fee') @RequireAdminPermission('visa_configure')
  async saveAssistanceFee(@Body(new ValidationPipe({expectedType:AssistanceFeeBody,transform:true,whitelist:true,forbidNonWhitelisted:true})) body: AssistanceFeeBody, @CurrentStaff() staff: AdminIdentity, @Req() request: ContextRequest) { return response(request, await this.visaOperations.saveAssistanceFee(body,staff,request.requestId)); }
  @Get('visa-assistance-requests') @RequireAdminPermission('visa_pii')
  async visaAssistanceRequests(@Req() request: ContextRequest) { return response(request, await this.visaOperations.assistanceRequests()); }
  @Get('visa-assistance-requests/:id') @RequireAdminPermission('visa_pii')
  async visaAssistanceRequest(@Param('id', new ParseUUIDPipe()) id: string, @CurrentStaff() staff: AdminIdentity,
    @Req() request: ContextRequest) { return response(request, await this.visaOperations.assistanceRequest(id, staff, request.requestId)); }
  @Get('visa/:id') @RequireAdminPermission('visa')
  async visa(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) { return response(request, await this.records.visa(id)); }
  @Post('visa/services') @RequireAdminPermission('visa_configure')
  async createVisaService(@Body() body: CreateVisaServiceBody, @CurrentStaff() staff: AdminIdentity, @Req() request: ContextRequest) {
    return response(request, await this.visaOperations.createService(body, staff, request.requestId));
  }
  @Post('visa/services/:visaTypeId/versions') @RequireAdminPermission('visa_configure')
  async createVisaServiceVersion(@Param('visaTypeId', new ParseUUIDPipe()) visaTypeId: string, @Body() body: VisaServiceBody,
    @CurrentStaff() staff: AdminIdentity, @Req() request: ContextRequest) {
    return response(request, await this.visaOperations.createVersion(visaTypeId, body, staff, request.requestId));
  }
  @Post('visa/services/:visaTypeId/requirements') @RequireAdminPermission('visa_configure')
  async addVisaRequirement(@Param('visaTypeId', new ParseUUIDPipe()) visaTypeId: string, @Body() body: VisaRequirementBody,
    @CurrentStaff() staff: AdminIdentity, @Req() request: ContextRequest) {
    return response(request, await this.visaOperations.addRequirement(visaTypeId, body, staff, request.requestId));
  }
  @Get('visa/:id/processing') @RequireAdminPermission('visa_pii')
  async visaProcessing(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) {
    return response(request, await this.visaOperations.processingDetail(id));
  }
  @Patch('visa/:id/status') @RequireAdminPermission('visa_manage')
  async changeVisaStatus(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: VisaStatusBody,
    @CurrentStaff() staff: AdminIdentity, @Req() request: ContextRequest) {
    return response(request, await this.visaOperations.changeStatus(id, body.status, body.customerMessage, body.internalNote, staff, request.requestId));
  }
  @Patch('visa/:id/requirements/:requirementId/review') @RequireAdminPermission('documents')
  async reviewVisaRequirement(@Param('id', new ParseUUIDPipe()) id: string, @Param('requirementId', new ParseUUIDPipe()) requirementId: string,
    @Body() body: VisaRequirementReviewBody, @CurrentStaff() staff: AdminIdentity, @Req() request: ContextRequest) {
    return response(request, await this.visaOperations.reviewRequirement(id, requirementId, body.status, body.reason, staff, request.requestId));
  }
  @Post('visa/:id/requests') @RequireAdminPermission('visa_manage')
  async requestVisaCorrection(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: VisaRequestBody,
    @CurrentStaff() staff: AdminIdentity, @Req() request: ContextRequest) {
    return response(request, await this.visaOperations.requestCorrection(id, body, staff, request.requestId));
  }
  @Post('visa/:id/notes') @RequireAdminPermission('visa_manage')
  async addVisaNote(@Param('id', new ParseUUIDPipe()) id: string, @Body() body: VisaNoteBody,
    @CurrentStaff() staff: AdminIdentity, @Req() request: ContextRequest) {
    return response(request, await this.visaOperations.addNote(id, body.note, body.visibility, staff, request.requestId));
  }
  @Get('visa/:id/documents/:documentId/versions/:versionId/access') @RequireAdminPermission('document_content')
  async visaDocumentAccess(@Param('id', new ParseUUIDPipe()) id: string, @Param('documentId', new ParseUUIDPipe()) documentId: string,
    @Param('versionId', new ParseUUIDPipe()) versionId: string, @CurrentStaff() staff: AdminIdentity,
    @Query('download') download: string | undefined, @Req() request: ContextRequest) {
    await this.visaOperations.assertApplicationDocument(id, documentId, versionId);
    return response(request, await this.documents.access(documentId, versionId, staff, request.requestId, download === 'true'));
  }

  @Get('documents') @RequireAdminPermission('documents')
  async documentList(@Query() query: ListQuery, @Req() request: ContextRequest) { return response(request, await this.documents.list(query)); }
  @Get('documents/:id') @RequireAdminPermission('documents')
  async document(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) { return response(request, await this.documents.detail(id)); }
  @Get('documents/:id/versions/:versionId/access') @RequireAdminPermission('document_content')
  async documentAccess(@Param('id', new ParseUUIDPipe()) id: string, @Param('versionId', new ParseUUIDPipe()) versionId: string,
    @CurrentStaff() staff: AdminIdentity, @Query('download') download: string | undefined, @Req() request: ContextRequest) {
    return response(request, await this.documents.access(id, versionId, staff, request.requestId, download === 'true'));
  }

  @Get('flights/search-activity') @RequireAdminPermission('flights')
  flightSummary(@Req() request: ContextRequest) { return response(request, this.flights.summary()); }
  @Get('flights/checkout-attempts') @RequireAdminPermission('flights')
  async guestCheckoutAttempts(@Query() query: ListQuery, @Req() request: ContextRequest) {
    return response(request, await this.flights.checkoutAttempts(query));
  }
  @Get('flights/checkout-attempts/:id') @RequireAdminPermission('flights')
  async guestCheckoutAttempt(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) {
    return response(request, await this.flights.checkoutAttempt(id));
  }
  @Get('flights/bookings') @RequireAdminPermission('flights')
  async flightBookings(@Query() query: ListQuery, @Req() request: ContextRequest) { return response(request, await this.flights.bookings(query)); }
  @Get('flights/bookings/:id') @RequireAdminPermission('flights')
  async flightBooking(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) {
    return response(request, await this.flights.booking(id));
  }
  @Post('flights/bookings/:id/refresh') @RequireAdminPermission('flights')
  async refreshFlightBooking(@Param('id', new ParseUUIDPipe()) id: string, @CurrentStaff() staff: AdminIdentity,
    @Req() request: ContextRequest) { return response(request, await this.flights.refresh(id, staff, request.requestId)); }
  @Get('orders') @RequireAdminPermission('orders')
  async orders(@Query() query: ListQuery, @Req() request: ContextRequest) { return response(request, await this.commerce.orders(query)); }
  @Get('orders/:id') @RequireAdminPermission('orders')
  async order(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) { return response(request, await this.commerce.order(id)); }
  @Get('payments') @RequireAdminPermission('payments')
  async payments(@Query() query: ListQuery, @Req() request: ContextRequest) { return response(request, await this.commerce.payments(query)); }
  @Get('payments/:id') @RequireAdminPermission('payments')
  async payment(@Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) { return response(request, await this.commerce.payment(id)); }
  @Get('audit') @RequireAdminPermission('audit')
  async audit(@Query() query: ListQuery, @Req() request: ContextRequest) { return response(request, await this.records.audit(query)); }
  @Get('settings') @RequireAdminPermission('settings')
  settings(@Req() request: ContextRequest) { return response(request, { adminConnection: 'configured',
    documentStorageConfigured: !!this.config.SUPABASE_STORAGE_SECRET_KEY,
    flightShoppingConfigured: false, paymentCheckoutConfigured: false }); }
}
