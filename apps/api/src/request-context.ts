import { randomUUID } from 'node:crypto';
import type { Request, Response, NextFunction } from 'express';
import type { FlyseriLogger } from '@flyseri/logging';
import type { CustomerProfile } from '@flyseri/types';

export interface AuthenticatedUserContext { authUserId: string; customerId: string; profile: CustomerProfile }
export interface ContextRequest extends Request { requestId: string; identity?: AuthenticatedUserContext }

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function resolveRequestId(incoming: unknown): string {
  return typeof incoming === 'string' && UUID_PATTERN.test(incoming) ? incoming : randomUUID();
}

export function requestContextMiddleware(logger: FlyseriLogger) {
  return (request: Request, response: Response, next: NextFunction): void => {
    const contextRequest = request as ContextRequest;
    contextRequest.requestId = resolveRequestId(request.headers['x-request-id']);
    response.setHeader('X-Request-ID', contextRequest.requestId);
    const start = performance.now();
    response.on('finish', () => {
      logger.info({
        requestId: contextRequest.requestId,
        method: request.method,
        route: request.path,
        statusCode: response.statusCode,
        durationMs: Math.round(performance.now() - start),
      }, 'HTTP request');
    });
    next();
  };
}
