import { BadRequestException, Body, Controller, Delete, Get, Inject, Param, ParseUUIDPipe, Post, Req, UseGuards, ValidationPipe } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsIn, IsOptional, IsString, IsUUID, Matches, MaxLength, MinLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import { GuestSeriService } from './guest-seri.service.js';
import type { ApiSuccess, SeriConversationSummary, SeriMessage, SeriTurnResponse } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { CurrentUser, CustomerAuthGuard } from '../customer/auth.js';
import { CustomerRateLimitGuard } from '../customer/rate-limit.guard.js';
import type { AuthenticatedUserContext, ContextRequest } from '../request-context.js';
import { SeriOrchestratorService } from './seri.service.js';

class CreateConversationDto { @IsOptional() @IsUUID() tripId?: string }
class SendMessageDto { @IsString() @MinLength(1) @MaxLength(4000) message!: string; @IsOptional() @IsIn(['en', 'bn']) language?: 'en' | 'bn' }
class SupportRequestDto { @IsString() @MinLength(1) @MaxLength(1000) reason!: string; @IsOptional() @IsUUID() bookingId?: string; @IsOptional() @IsUUID() conversationId?: string }
const validate = (type: new () => object) => new ValidationPipe({ expectedType: type, transform: true, whitelist: true, forbidNonWhitelisted: true,
  exceptionFactory: () => new BadRequestException('The request is invalid.') });
const response = <T>(request: ContextRequest, data: T): ApiSuccess<T> => ({ success: true, data, requestId: request.requestId });

class GuestHistoryDto {
  @IsIn(['USER', 'ASSISTANT']) role!: 'USER' | 'ASSISTANT';
  @IsString() @MinLength(1) @MaxLength(4000) content!: string;
}
class GuestMessageDto extends SendMessageDto {
  @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => GuestHistoryDto) history!: GuestHistoryDto[];
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency?: string;
}
@Controller('seri/guest')
export class GuestSeriController {
  constructor(@Inject(GuestSeriService) private readonly seri: GuestSeriService) {}
  @Post('messages')
  async send(@Body(validate(GuestMessageDto)) body: GuestMessageDto, @Req() request: ContextRequest) {
    return response(request, await this.seri.send(body, request.socket?.remoteAddress ?? request.ip ?? 'unknown'));
  }
}

@Controller('seri')
@UseGuards(CustomerAuthGuard)
export class SeriController {
  constructor(@Inject(SeriOrchestratorService) private readonly seri: SeriOrchestratorService) {}
  @Post('support-requests/prepare')
  @UseGuards(CustomerRateLimitGuard)
  async prepareSupport(@CurrentUser() user: AuthenticatedUserContext, @Body(validate(SupportRequestDto)) body: SupportRequestDto, @Req() request: ContextRequest) {
    return response(request, await this.seri.prepareSupport(user, body));
  }
  @Get('conversations')
  async list(@CurrentUser() user: AuthenticatedUserContext, @Req() request: ContextRequest): Promise<ApiSuccess<SeriConversationSummary[]>> {
    return response(request, await this.seri.listConversations(user.customerId));
  }
  @Post('conversations')
  async create(@CurrentUser() user: AuthenticatedUserContext, @Body(validate(CreateConversationDto)) body: CreateConversationDto, @Req() request: ContextRequest): Promise<ApiSuccess<SeriConversationSummary>> {
    return response(request, await this.seri.createConversation(user, body.tripId));
  }
  @Get('conversations/:conversationId/messages')
  async messages(@CurrentUser() user: AuthenticatedUserContext, @Param('conversationId', ParseUUIDPipe) id: string, @Req() request: ContextRequest): Promise<ApiSuccess<SeriMessage[]>> {
    const result = await this.seri.getMessages(user.customerId, id);
    if (!result) throw new ApiException('NOT_FOUND', 'This Seri conversation could not be found.', 404);
    return response(request, result);
  }
  @Post('conversations/:conversationId/messages')
  async send(@CurrentUser() user: AuthenticatedUserContext, @Param('conversationId', ParseUUIDPipe) id: string,
    @Body(validate(SendMessageDto)) body: SendMessageDto, @Req() request: ContextRequest): Promise<ApiSuccess<SeriTurnResponse>> {
    return response(request, await this.seri.send(user, id, body.message, request.requestId, body.language));
  }
  @Post('conversations/:conversationId/actions/:actionId/confirm')
  @UseGuards(CustomerRateLimitGuard)
  async confirm(@CurrentUser() user: AuthenticatedUserContext, @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('actionId', ParseUUIDPipe) actionId: string, @Req() request: ContextRequest): Promise<ApiSuccess<SeriMessage>> {
    return response(request, await this.seri.confirmAction(user.customerId, conversationId, actionId));
  }
  @Delete('conversations/:conversationId/actions/:actionId')
  @UseGuards(CustomerRateLimitGuard)
  async cancel(@CurrentUser() user: AuthenticatedUserContext, @Param('conversationId', ParseUUIDPipe) conversationId: string,
    @Param('actionId', ParseUUIDPipe) actionId: string, @Req() request: ContextRequest): Promise<ApiSuccess<SeriMessage>> {
    return response(request, await this.seri.cancelAction(user.customerId, conversationId, actionId));
  }
}
