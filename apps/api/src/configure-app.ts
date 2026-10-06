import { BadRequestException, ValidationPipe, type INestApplication } from '@nestjs/common';
import helmet from 'helmet';
import type { AppConfig } from '@flyseri/config';
import type { FlyseriLogger } from '@flyseri/logging';
import { ApiErrorFilter } from './api-error.filter.js';
import { requestContextMiddleware } from './request-context.js';

export function configureApp(app: INestApplication, config: AppConfig, logger: FlyseriLogger): void {
  app.use(helmet());
  app.use(requestContextMiddleware(logger));
  app.enableCors({ origin: config.WEB_ORIGIN, credentials: true });
  app.setGlobalPrefix('api/v1');
  app.useGlobalPipes(new ValidationPipe({
    transform: true,
    whitelist: true,
    forbidNonWhitelisted: true,
    forbidUnknownValues: true,
    exceptionFactory: () => new BadRequestException('The request is invalid.'),
  }));
  app.useGlobalFilters(new ApiErrorFilter(logger));
  app.enableShutdownHooks();
}
