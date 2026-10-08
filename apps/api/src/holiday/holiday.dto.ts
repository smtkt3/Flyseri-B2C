import { ArrayMaxSize, ArrayMinSize, IsArray, IsBoolean, IsEmail, IsIn, IsInt, IsNumber, IsString, IsUUID, Matches, Max, MaxLength, Min, MinLength } from 'class-validator';

export class HolidayPackageDto {
  @IsString() @MinLength(3) @MaxLength(120) title!: string;
  @IsIn(['DOMESTIC', 'INTERNATIONAL']) category!: 'DOMESTIC' | 'INTERNATIONAL';
  @IsString() @MinLength(2) @MaxLength(120) location!: string;
  @Matches(/^[A-Z]{2}$/) countryCode!: string;
  @IsString() @MaxLength(1000) @Matches(/^https:\/\//) imageUrl!: string;
  @IsString() @MinLength(10) @MaxLength(2000) summary!: string;
  @IsInt() @Min(1) @Max(90) days!: number;
  @IsInt() @Min(0) @Max(89) nights!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(1) @Max(10000000) adultPrice!: number;
  @IsNumber({ maxDecimalPlaces: 2 }) @Min(0) @Max(10000000) childPrice!: number;
  @IsIn(['BDT']) currency!: 'BDT';
  @IsInt() @Min(1) @Max(50) maxPax!: number;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(120) @Matches(/^\d{4}-\d{2}-\d{2}$/, { each: true }) departureDates!: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(300, { each: true }) inclusions!: string[];
  @IsArray() @ArrayMaxSize(30) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(300, { each: true }) exclusions!: string[];
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(90) @IsString({ each: true }) @MinLength(1, { each: true }) @MaxLength(1500, { each: true }) itinerary!: string[];
  @IsString() @MinLength(10) @MaxLength(3000) cancellationPolicy!: string;
  @IsBoolean() published!: boolean;
  @IsInt() @Min(0) version!: number;
}
export class HolidayBookingDto {
  @IsUUID() packageId!: string;
  @IsInt() @Min(1) packageVersion!: number;
  @Matches(/^\d{4}-\d{2}-\d{2}$/) departureDate!: string;
  @IsInt() @Min(1) @Max(50) adults!: number;
  @IsInt() @Min(0) @Max(49) children!: number;
  @IsString() @MinLength(2) @MaxLength(120) contactName!: string;
  @IsEmail() @MaxLength(254) email!: string;
  @Matches(/^\+?[0-9 ()-]{7,24}$/) phone!: string;
  @IsUUID() idempotencyKey!: string;
}
export class HolidayBookingStatusDto {
  @IsIn(['CONFIRMED', 'CANCELLED']) status!: 'CONFIRMED' | 'CANCELLED';
}
