import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayUnique, IsArray, IsIn, IsISO31661Alpha2, IsOptional, IsString, IsUUID, MaxLength, ValidateBy, ValidateNested } from 'class-validator';
import type { TripStatus } from '@flyseri/types';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const statuses: TripStatus[] = ['PLANNING', 'ACTIVE', 'COMPLETED', 'CANCELLED'];
export function validTripDate(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value;
}
const IsTripDate = () => ValidateBy({ name: 'isTripDate', validator: { validate: validTripDate } });

export class DestinationDto {
  @IsISO31661Alpha2() countryCode!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) cityName?: string | null;
  @IsOptional() @IsTripDate() startDate?: string | null;
  @IsOptional() @IsTripDate() endDate?: string | null;
}

export class CreateTripDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) title?: string | null;
  @IsOptional() @IsIn(statuses) status?: TripStatus;
  @IsOptional() @IsTripDate() startDate?: string | null;
  @IsOptional() @IsTripDate() endDate?: string | null;
  @IsOptional() @IsArray() @ArrayMaxSize(12) @ValidateNested({ each: true }) @Type(() => DestinationDto) destinations?: DestinationDto[];
  @IsOptional() @IsArray() @ArrayMaxSize(30) @ArrayUnique() @IsUUID('all', { each: true }) travellerIds?: string[];
}

export class UpdateTripDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) title?: string | null;
  @IsOptional() @IsIn(statuses) status?: TripStatus;
  @IsOptional() @IsTripDate() startDate?: string | null;
  @IsOptional() @IsTripDate() endDate?: string | null;
}

export class AddTripTravellerDto { @IsUUID('all') travellerId!: string; }
export class UpdateDestinationDto {
  @IsOptional() @IsISO31661Alpha2() countryCode?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) cityName?: string | null;
  @IsOptional() @IsTripDate() startDate?: string | null;
  @IsOptional() @IsTripDate() endDate?: string | null;
}

export class TripListQueryDto {
  @IsOptional() @IsIn(statuses) status?: TripStatus;
  @IsOptional() @IsIn(['upcoming', 'past']) period?: 'upcoming' | 'past';
  @IsOptional() @IsIn(['true', 'false']) archived?: 'true' | 'false';
}
