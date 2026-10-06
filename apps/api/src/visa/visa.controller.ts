import { BadRequestException, Body, Header, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Patch, Post, Query, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import type { ApiSuccess, VisaApplicationDetail, VisaApplicationRequirement, VisaApplicationSummary, VisaAssistanceRequestSummary, VisaType } from '@flyseri/types';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { CurrentUser, CustomerAuthGuard } from '../customer/auth.js';
import { CustomerRateLimitGuard } from '../customer/rate-limit.guard.js';
import { SaveAssistanceNoteDto, SubmitAssistanceRequestDto, LinkDocumentDto, SaveVisaAnswersDto, StartVisaDto, SubmitVisaDto, VisaActionDto, VisaAssistanceRequestDto, VisaListDto } from './dto.js';
import { VisaService } from './visa.service.js';

const validated = (type: new () => object) => new ValidationPipe({ expectedType: type, transform: true, whitelist: true, forbidNonWhitelisted: true, exceptionFactory: () => new BadRequestException('The request is invalid.') });
const response = <T>(request: ContextRequest, data: T): ApiSuccess<T> => ({ success: true, data, requestId: request.requestId });
@Controller()
@UseGuards(CustomerAuthGuard)
export class VisaController {
  constructor(@Inject(VisaService) private readonly service: VisaService) {}
  @Get('visa-services')
  async catalogue(@Query('countryCode') countryCode: string, @Req() request: ContextRequest): Promise<ApiSuccess<VisaType[]>> {
    if (!/^[A-Za-z]{2}$/.test(countryCode ?? '')) throw new BadRequestException('Choose a valid country.');
    return response(request, await this.service.catalogue(countryCode.toUpperCase()));
  }
  @Post('visa-assistance-requests')
  @UseGuards(CustomerRateLimitGuard)
  async createAssistanceRequest(@CurrentUser() user: AuthenticatedUserContext,
    @Body(validated(VisaAssistanceRequestDto)) body: VisaAssistanceRequestDto, @Req() request: ContextRequest): Promise<ApiSuccess<VisaAssistanceRequestSummary>> {
    return response(request, await this.service.createAssistanceRequest(user.customerId, body));
  }
  @Get('visa-assistance-requests')
  @Header('Cache-Control', 'no-store')
  async assistanceList(@CurrentUser() user: AuthenticatedUserContext, @Req() request: ContextRequest) { return response(request, await this.service.assistanceList(user.customerId)); }
  @Patch('visa-assistance-requests/:id/form')
  @Header('Cache-Control', 'no-store')
  @UseGuards(CustomerRateLimitGuard)
  async assistanceForm(@CurrentUser() user: AuthenticatedUserContext, @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validated(VisaAssistanceRequestDto)) body: VisaAssistanceRequestDto, @Req() request: ContextRequest) { return response(request, await this.service.saveAssistanceForm(user.customerId, id, body)); }
  @Get('visa-assistance-requests/:id')
  @Header('Cache-Control', 'no-store')
  async assistanceDetail(@CurrentUser() user: AuthenticatedUserContext, @Param('id', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest) { return response(request, await this.service.assistanceDetail(user.customerId, id)); }
  @Post('visa-assistance-requests/:id/applicants/:travellerId/documents')
  @UseGuards(CustomerRateLimitGuard)
  async assistanceLink(@CurrentUser() user: AuthenticatedUserContext, @Param('id', new ParseUUIDPipe()) id: string, @Param('travellerId', new ParseUUIDPipe()) travellerId: string, @Body(validated(LinkDocumentDto)) body: LinkDocumentDto, @Req() request: ContextRequest) { return response(request, await this.service.assistanceAction(user.customerId, id, 'LINK', { travellerId, ...body })); }
  @Delete('visa-assistance-requests/:id/documents/:linkId')
  @UseGuards(CustomerRateLimitGuard)
  async assistanceUnlink(@CurrentUser() user: AuthenticatedUserContext, @Param('id', new ParseUUIDPipe()) id: string, @Param('linkId', new ParseUUIDPipe()) linkId: string, @Req() request: ContextRequest) { return response(request, await this.service.assistanceAction(user.customerId, id, 'UNLINK', { linkId })); }
  @Patch('visa-assistance-requests/:id/note')
  @Header('Cache-Control', 'no-store')
  @UseGuards(CustomerRateLimitGuard)
  async assistanceNote(@CurrentUser() user: AuthenticatedUserContext, @Param('id', new ParseUUIDPipe()) id: string,
    @Body(validated(SaveAssistanceNoteDto)) body: SaveAssistanceNoteDto, @Req() request: ContextRequest) { return response(request, await this.service.assistanceAction(user.customerId, id, 'NOTE', body)); }
  @Post('visa-assistance-requests/:id/submit')
  @UseGuards(CustomerRateLimitGuard)
  async assistanceSubmit(@CurrentUser() user: AuthenticatedUserContext, @Param('id', new ParseUUIDPipe()) id: string, @Body(validated(SubmitAssistanceRequestDto)) body: SubmitAssistanceRequestDto, @Req() request: ContextRequest) { return response(request, await this.service.assistanceAction(user.customerId, id, 'SUBMIT', body)); }
  @Get('trips/:tripId/visa-types')
  async types(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Req() request: ContextRequest): Promise<ApiSuccess<VisaType[]>> {
    return response(request, await this.service.types(user.customerId, tripId));
  }
  @Post('trips/:tripId/visa-applications')
  @UseGuards(CustomerRateLimitGuard)
  async create(@CurrentUser() user: AuthenticatedUserContext, @Param('tripId', new ParseUUIDPipe()) tripId: string, @Body(validated(StartVisaDto)) body: StartVisaDto, @Req() request: ContextRequest): Promise<ApiSuccess<VisaApplicationDetail>> {
    return response(request, await this.service.create(user.customerId, tripId, body.visaTypeId, body.travellerIds));
  }
  @Get('visa-applications')
  async list(@CurrentUser() user: AuthenticatedUserContext, @Query(validated(VisaListDto)) query: VisaListDto, @Req() request: ContextRequest): Promise<ApiSuccess<VisaApplicationSummary[]>> {
    return response(request, await this.service.list(user.customerId, query.tripId));
  }
  @Get('visa-applications/:applicationId')
  async detail(@CurrentUser() user: AuthenticatedUserContext, @Param('applicationId', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<VisaApplicationDetail>> {
    return response(request, await this.service.detail(user.customerId, id));
  }
  @Get('visa-applications/:applicationId/requirements')
  async requirements(@CurrentUser() user: AuthenticatedUserContext, @Param('applicationId', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<VisaApplicationRequirement[]>> {
    return response(request, (await this.service.detail(user.customerId, id)).requirements);
  }
  @Patch('visa-applications/:applicationId')
  @UseGuards(CustomerRateLimitGuard)
  async action(@CurrentUser() user: AuthenticatedUserContext, @Param('applicationId', new ParseUUIDPipe()) id: string, @Body(validated(VisaActionDto)) body: VisaActionDto, @Req() request: ContextRequest): Promise<ApiSuccess<VisaApplicationDetail>> {
    return response(request, await this.service.action(user.customerId, id, body.action));
  }
  @Patch('visa-applications/:applicationId/answers')
  @UseGuards(CustomerRateLimitGuard)
  async saveAnswers(@CurrentUser() user: AuthenticatedUserContext, @Param('applicationId', new ParseUUIDPipe()) id: string,
    @Body(validated(SaveVisaAnswersDto)) body: SaveVisaAnswersDto, @Req() request: ContextRequest): Promise<ApiSuccess<VisaApplicationDetail>> {
    return response(request, await this.service.saveAnswers(user.customerId, id, body.scope, body.answers));
  }
  @Post('visa-applications/:applicationId/submit')
  @UseGuards(CustomerRateLimitGuard)
  async submit(@CurrentUser() user: AuthenticatedUserContext, @Param('applicationId', new ParseUUIDPipe()) id: string,
    @Body(validated(SubmitVisaDto)) body: SubmitVisaDto, @Req() request: ContextRequest): Promise<ApiSuccess<VisaApplicationDetail>> {
    return response(request, await this.service.submit(user.customerId, id, body.declarationVersion));
  }
  @Delete('visa-applications/:applicationId')
  @UseGuards(CustomerRateLimitGuard)
  async archive(@CurrentUser() user: AuthenticatedUserContext, @Param('applicationId', new ParseUUIDPipe()) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<{ archived: true }>> {
    return response(request, await this.service.archive(user.customerId, id));
  }
  @Post('visa-applications/:applicationId/requirements/:requirementId/documents')
  @UseGuards(CustomerRateLimitGuard)
  async link(@CurrentUser() user: AuthenticatedUserContext, @Param('applicationId', new ParseUUIDPipe()) id: string, @Param('requirementId', new ParseUUIDPipe()) requirementId: string, @Body(validated(LinkDocumentDto)) body: LinkDocumentDto, @Req() request: ContextRequest): Promise<ApiSuccess<VisaApplicationDetail>> {
    return response(request, await this.service.link(user.customerId, id, requirementId, body.documentId, body.documentVersionId));
  }
  @Delete('visa-applications/:applicationId/requirements/:requirementId/documents/:documentId')
  @UseGuards(CustomerRateLimitGuard)
  async unlink(@CurrentUser() user: AuthenticatedUserContext, @Param('applicationId', new ParseUUIDPipe()) id: string, @Param('requirementId', new ParseUUIDPipe()) requirementId: string, @Param('documentId', new ParseUUIDPipe()) documentId: string, @Req() request: ContextRequest): Promise<ApiSuccess<VisaApplicationDetail>> {
    return response(request, await this.service.unlink(user.customerId, id, requirementId, documentId));
  }
}
