import { Body, Controller, Header, HttpCode, Inject, Post, Req, ValidationPipe } from '@nestjs/common';
import { ArrayMaxSize, IsArray, IsOptional, IsString, Matches, MaxLength, ValidateNested } from 'class-validator';
import { Type } from 'class-transformer';
import type { ContextRequest } from '../request-context.js';
import { FlightDisplayCurrencyService } from './flight-display-currency.service.js';

class DisplayPriceDto {
  @IsOptional() @IsString() @MaxLength(32) @Matches(/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/) amount!: string | null;
  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/) currency!: string | null;
}
class DisplayPricesDto {
  @IsString() @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsArray() @ArrayMaxSize(1000) @ValidateNested({ each: true }) @Type(() => DisplayPriceDto) prices!: DisplayPriceDto[];
}
@Controller('flights')
export class FlightDisplayCurrencyController {
  constructor(@Inject(FlightDisplayCurrencyService) private readonly display: FlightDisplayCurrencyService) {}
  @Post('ancillary-display-prices') @HttpCode(200) @Header('Cache-Control', 'no-store')
  async convert(@Body(new ValidationPipe({ expectedType: DisplayPricesDto, transform: true, whitelist: true, forbidNonWhitelisted: true })) input: DisplayPricesDto,
    @Req() request: ContextRequest) {
    return { success: true, data: await this.display.convert(input.prices, input.currency), requestId: request.requestId };
  }
}
