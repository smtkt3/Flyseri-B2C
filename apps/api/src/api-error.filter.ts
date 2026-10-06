import { ArgumentsHost, Catch, HttpException, HttpStatus, type ExceptionFilter } from '@nestjs/common';
import type { Response } from 'express';
import type { ApiErrorCode, ApiErrorResponse } from '@flyseri/types';
import type { FlyseriLogger } from '@flyseri/logging';
import type { ContextRequest } from './request-context.js';
import { ApiException } from './api-exception.js';

const codes: Record<number, ApiErrorCode> = {
  400: 'VALIDATION_ERROR', 401: 'UNAUTHORIZED', 403: 'FORBIDDEN',
  404: 'NOT_FOUND', 409: 'CONFLICT', 413: 'VALIDATION_ERROR', 429: 'RATE_LIMITED', 503: 'DEPENDENCY_UNAVAILABLE',
};

const messages: Partial<Record<ApiErrorCode, string>> = {
  VALIDATION_ERROR: 'The request is invalid.',
  NOT_FOUND: 'The requested resource was not found.',
  UNAUTHORIZED: 'Authentication is required.',
  AUTHENTICATION_REQUIRED: 'Please sign in to continue.',
  INVALID_SESSION: 'Your session has expired. Please sign in again.',
  FORBIDDEN: 'You cannot access this resource.',
  CONFLICT: 'The request conflicts with the current state.',
  RATE_LIMITED: 'Please try again later.',
  DEPENDENCY_UNAVAILABLE: 'A service is temporarily unavailable.',
  INTERNAL_ERROR: 'Something went wrong. Please try again.',
};

@Catch()
export class ApiErrorFilter implements ExceptionFilter {
  constructor(private readonly logger: FlyseriLogger) {}

  catch(exception: unknown, host: ArgumentsHost): void {
    const response = host.switchToHttp().getResponse<Response>();
    const request = host.switchToHttp().getRequest<ContextRequest>();
    const status = exception instanceof HttpException ? exception.getStatus() : HttpStatus.INTERNAL_SERVER_ERROR;
    const code = exception instanceof ApiException ? exception.code : codes[status] ?? 'INTERNAL_ERROR';
    if (status >= 500) {
      this.logger.error({ requestId: request.requestId, statusCode: status, errorName: exception instanceof Error ? exception.name : 'Unknown' }, 'API request failed');
    }
    const body: ApiErrorResponse = {
      success: false,
      error: { code, message: exception instanceof ApiException ? exception.message : messages[code] ?? messages.INTERNAL_ERROR!, requestId: request.requestId },
    };
    response.status(status).json(body);
  }
}
