import { Transform } from 'class-transformer';
import { IsBoolean, IsIn, IsISO31661Alpha2, IsNotEmpty, IsOptional, IsString, Matches, MaxLength, MinLength, ValidateBy, ValidateIf } from 'class-validator';
import type { TravellerGender, TravellerRelationship } from '@flyseri/types';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const namePattern = /^[\p{L}][\p{L} .'’-]*$/u;
const relationshipValues: TravellerRelationship[] = ['SELF', 'SPOUSE', 'CHILD', 'PARENT', 'SIBLING', 'RELATIVE', 'FRIEND', 'OTHER'];
const genderValues: TravellerGender[] = ['FEMALE', 'MALE', 'X', 'UNDISCLOSED'];

export function validDateOfBirth(value: unknown): boolean {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.valueOf()) && date.toISOString().slice(0, 10) === value && value <= new Date().toISOString().slice(0, 10);
}

const IsDateOfBirth = () => ValidateBy({ name: 'isDateOfBirth', validator: { validate: validDateOfBirth, defaultMessage: () => 'dateOfBirth must be a real date on or before today' } });

export class UpdateMeDto {
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) @MinLength(1)
  displayName?: string | null;

  @IsOptional() @IsString() @Matches(/^\+[1-9]\d{0,3}$/)
  phoneCountryCode?: string | null;

  @IsOptional() @IsString() @Matches(/^\d{4,20}$/)
  phoneNumber?: string | null;

  @IsOptional() @IsString() @Matches(/^[a-z]{2,3}(?:-[A-Z]{2})?$/)
  preferredLanguage?: string | null;

  @IsOptional() @IsString() @Matches(/^[A-Z]{3}$/)
  preferredCurrency?: string | null;
}

export class CreateTravellerDto {
  @IsOptional() @IsBoolean() saveForFuture?: boolean;
  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) @Matches(namePattern)
  legalFirstName!: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) @Matches(namePattern)
  legalMiddleName?: string | null;

  @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) @Matches(namePattern)
  legalLastName!: string;

  @IsOptional() @IsDateOfBirth()
  dateOfBirth?: string | null;

  @IsOptional() @IsIn(genderValues)
  gender?: TravellerGender | null;

  @IsOptional() @IsISO31661Alpha2()
  nationalityCountryCode?: string | null;

  @IsIn(relationshipValues)
  relationshipType!: TravellerRelationship;
}
export class SavePassportDto {
  @IsIn([true]) saveForFuture!: true;
  @IsString() @Matches(/^[A-Z0-9]{3,30}$/) documentNumber!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) expiryDate!: string;
  @IsISO31661Alpha2() issuingCountryCode!: string;
}

export class UpdateTravellerDto {
  @ValidateIf((_object, value) => value !== undefined) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) @Matches(namePattern)
  legalFirstName?: string;

  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) @Matches(namePattern)
  legalMiddleName?: string | null;

  @ValidateIf((_object, value) => value !== undefined) @Transform(trim) @IsString() @IsNotEmpty() @MaxLength(100) @Matches(namePattern)
  legalLastName?: string;

  @IsOptional() @IsDateOfBirth()
  dateOfBirth?: string | null;

  @IsOptional() @IsIn(genderValues)
  gender?: TravellerGender | null;

  @IsOptional() @IsISO31661Alpha2()
  nationalityCountryCode?: string | null;

  @IsOptional() @IsIn(relationshipValues)
  relationshipType?: TravellerRelationship;
}
