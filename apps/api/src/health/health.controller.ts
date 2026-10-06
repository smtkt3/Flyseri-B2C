import { Controller, Get, Inject, ParseBoolPipe, Query, Req, ServiceUnavailableException } from '@nestjs/common';
import type { ApiSuccess, HealthResponse } from '@flyseri/types';
import type { ContextRequest } from '../request-context.js';
import { HealthService } from './health.service.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(HealthService) private readonly health: HealthService) {}

  @Get()
  async live(
    @Req() request: ContextRequest,
    @Query('details', new ParseBoolPipe({ optional: true })) details?: boolean,
  ): Promise<ApiSuccess<HealthResponse>> {
    const data = details ? await this.health.ready() : this.health.live();
    if (!data) throw new ServiceUnavailableException();
    return { success: true, data, requestId: request.requestId };
  }

  @Get('ready')
  async ready(@Req() request: ContextRequest): Promise<ApiSuccess<HealthResponse>> {
    const data = await this.health.ready();
    if (!data) throw new ServiceUnavailableException();
    return { success: true, data, requestId: request.requestId };
  }
}
