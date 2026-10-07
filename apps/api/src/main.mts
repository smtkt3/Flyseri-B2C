import 'reflect-metadata';
import { config as loadDotEnv } from 'dotenv';
import { fileURLToPath } from 'node:url';
import { NestFactory } from '@nestjs/core';
import { parseConfig } from '@flyseri/config';
import { createLogger } from '@flyseri/logging';
import { AppModule } from './app.module.js';
import { configureApp } from './configure-app.js';

loadDotEnv({ path: fileURLToPath(new URL('../../../.env', import.meta.url)) });

async function bootstrap(): Promise<void> {
  const config = parseConfig(process.env);
  const logger = createLogger(config.APP_ENV);
  const app = await NestFactory.create(AppModule, { logger: false, rawBody: true, abortOnError: false });
  configureApp(app, config, logger);
  const port = process.env.PORT ? Number(process.env.PORT) : config.API_PORT;
  await app.listen(port);
  logger.info({ port }, 'Flyseri API started');
}

bootstrap().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : 'Unknown startup error';
  process.stderr.write(`Flyseri API startup failed: ${message}\n`);
  process.exitCode = 1;
});
