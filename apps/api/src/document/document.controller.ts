import { BadRequestException, Body, Controller, Delete, Get, Header, Headers, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UploadedFile, UseGuards, UseInterceptors, ValidationPipe } from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { ApiSuccess, DocumentAccess, DocumentDetail, DocumentSummary } from '@flyseri/types';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { CurrentUser, CustomerAuthGuard } from '../customer/auth.js';
import { CustomerRateLimitGuard } from '../customer/rate-limit.guard.js';
import { CreateDocumentDto, DocumentAccessDto, DocumentListDto, UpdateDocumentDto } from './dto.js';
import { DocumentService } from './document.service.js';
import type { UploadFile } from './file-validation.js';

const validated = (type: new () => object) => new ValidationPipe({ expectedType: type, transform: true, whitelist: true, forbidNonWhitelisted: true, exceptionFactory: () => new BadRequestException('The request is invalid.') });
const response = <T>(request: ContextRequest, data: T): ApiSuccess<T> => ({ success: true, data, requestId: request.requestId });
@Controller('documents')
@UseGuards(CustomerAuthGuard)
export class DocumentController {
  constructor(@Inject(DocumentService) private readonly service: DocumentService) {}
  @Get()
  async list(@CurrentUser() user: AuthenticatedUserContext, @Query(validated(DocumentListDto)) query: DocumentListDto, @Req() request: ContextRequest): Promise<ApiSuccess<DocumentSummary[]>> {
    return response(request, await this.service.list(user.customerId, query));
  }
  @Post()
  @UseGuards(CustomerRateLimitGuard)
  async create(@CurrentUser() user: AuthenticatedUserContext, @Body(validated(CreateDocumentDto)) body: CreateDocumentDto, @Req() request: ContextRequest): Promise<ApiSuccess<DocumentDetail>> {
    return response(request, await this.service.create(user.customerId, body));
  }
  @Get('upload-policy')
  policy(@Req() request: ContextRequest): ApiSuccess<{ maxUploadMb: number; acceptedTypes: string[] }> { return response(request, this.service.policy()); }
  @Get(':documentId')
  async detail(@CurrentUser() user: AuthenticatedUserContext, @Param('documentId', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<DocumentDetail>> {
    return response(request, await this.service.detail(user.customerId, id));
  }
  @Patch(':documentId')
  @UseGuards(CustomerRateLimitGuard)
  async update(@CurrentUser() user: AuthenticatedUserContext, @Param('documentId', new ParseUUIDPipe()) id: string, @Body(validated(UpdateDocumentDto)) body: UpdateDocumentDto, @Req() request: ContextRequest): Promise<ApiSuccess<DocumentDetail>> {
    return response(request, await this.service.update(user.customerId, id, body));
  }
  @Delete(':documentId')
  @UseGuards(CustomerRateLimitGuard)
  async archive(@CurrentUser() user: AuthenticatedUserContext, @Param('documentId', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<{ archived: true }>> {
    return response(request, await this.service.archive(user.customerId, id));
  }
  @Post(':documentId/versions')
  @UseGuards(CustomerRateLimitGuard)
  @UseInterceptors(FileInterceptor('file'))
  async upload(@CurrentUser() user: AuthenticatedUserContext, @Param('documentId', new ParseUUIDPipe()) id: string, @Headers('idempotency-key') key: string | undefined, @UploadedFile() file: UploadFile | undefined, @Req() request: ContextRequest): Promise<ApiSuccess<DocumentDetail>> {
    return response(request, await this.service.upload(user.customerId, id, key, file));
  }
  @Get(':documentId/access-url')
  @Header('Cache-Control', 'no-store')
  async access(@CurrentUser() user: AuthenticatedUserContext, @Param('documentId', new ParseUUIDPipe()) id: string, @Query(validated(DocumentAccessDto)) query: DocumentAccessDto, @Req() request: ContextRequest): Promise<ApiSuccess<DocumentAccess>> {
    return response(request, await this.service.access(user.customerId, id, undefined, query.download === 'true'));
  }
  @Get(':documentId/versions/:versionId/access-url')
  @Header('Cache-Control', 'no-store')
  async previous(@CurrentUser() user: AuthenticatedUserContext, @Param('documentId', new ParseUUIDPipe()) id: string, @Param('versionId', new ParseUUIDPipe()) versionId: string, @Query(validated(DocumentAccessDto)) query: DocumentAccessDto, @Req() request: ContextRequest): Promise<ApiSuccess<DocumentAccess>> {
    return response(request, await this.service.access(user.customerId, id, versionId, query.download === 'true'));
  }
}
