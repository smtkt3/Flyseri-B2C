import { Controller, Get, Header, Inject, Module, Req } from '@nestjs/common';
import type { ContextRequest } from '../request-context.js';
import { WeatherService } from './weather.service.js';

@Controller('weather')
class WeatherController {
  constructor(@Inject(WeatherService) private readonly weather: WeatherService) {}
  @Get('destinations')
  @Header('Cache-Control', 'public, max-age=300, s-maxage=600')
  async destinations(@Req() req: ContextRequest) { return { success: true, data: await this.weather.all(), requestId: req.requestId }; }
}

@Module({ controllers: [WeatherController], providers: [WeatherService] })
export class WeatherModule {}
