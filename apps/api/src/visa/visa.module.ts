import { Module } from '@nestjs/common';
import { PublicVisaCatalogueController, VisaController } from './visa.controller.js';
import { VisaService } from './visa.service.js';

@Module({ controllers: [VisaController, PublicVisaCatalogueController], providers: [VisaService], exports: [VisaService] })
export class VisaModule {}
