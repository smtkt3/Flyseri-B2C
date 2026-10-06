import { Module } from '@nestjs/common';
import { MulterModule } from '@nestjs/platform-express';
import type { AppConfig } from '@flyseri/config';
import { APP_CONFIG } from '../tokens.js';
import { DocumentController } from './document.controller.js';
import { DocumentService } from './document.service.js';

@Module({ imports: [MulterModule.registerAsync({ inject: [APP_CONFIG], useFactory: (config: AppConfig) => ({ limits: { fileSize: config.DOCUMENT_MAX_UPLOAD_MB * 1024 * 1024, files: 1, fields: 0 } }) })], controllers: [DocumentController], providers: [DocumentService], exports: [DocumentService] })
export class DocumentModule {}
