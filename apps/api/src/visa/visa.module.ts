import { Module } from '@nestjs/common';
import { VisaController } from './visa.controller.js';
import { VisaService } from './visa.service.js';

@Module({ controllers: [VisaController], providers: [VisaService], exports: [VisaService] })
export class VisaModule {}
