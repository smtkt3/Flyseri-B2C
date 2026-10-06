import { Transform } from 'class-transformer';
import { IsIn, IsISO31661Alpha2, IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';
import type { DocumentType } from '@flyseri/types';
import { validTripDate } from '../trip/dto.js';
import { ValidateBy } from 'class-validator';

export const documentTypes: DocumentType[] = ['PASSPORT', 'NATIONAL_ID', 'PASSPORT_PHOTO', 'RESIDENCE_PERMIT', 'BANK_STATEMENT', 'EMPLOYMENT_LETTER', 'MARRIAGE_CERTIFICATE', 'BIRTH_CERTIFICATE', 'COMPANY_DOCUMENT', 'PREVIOUS_VISA', 'TRAVEL_DOCUMENT', 'OTHER'];
export const personBoundDocumentTypes: DocumentType[] = ['PASSPORT', 'NATIONAL_ID', 'PASSPORT_PHOTO', 'RESIDENCE_PERMIT', 'BIRTH_CERTIFICATE', 'PREVIOUS_VISA', 'TRAVEL_DOCUMENT'];
const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const IsDateOnly = () => ValidateBy({ name: 'isDateOnly', validator: { validate: validTripDate } });

export class CreateDocumentDto {
  @IsIn(documentTypes) documentType!: DocumentType;
  @IsOptional() @IsUUID('all') travellerId?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) displayName?: string | null;
  @IsOptional() @IsDateOnly() issuedOn?: string | null;
  @IsOptional() @IsDateOnly() expiresOn?: string | null;
  @IsOptional() @IsISO31661Alpha2() issuingCountryCode?: string | null;
}
export class UpdateDocumentDto {
  @IsOptional() @IsUUID('all') travellerId?: string | null;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) displayName?: string | null;
  @IsOptional() @IsDateOnly() issuedOn?: string | null;
  @IsOptional() @IsDateOnly() expiresOn?: string | null;
  @IsOptional() @IsISO31661Alpha2() issuingCountryCode?: string | null;
}
export class DocumentListDto {
  @IsOptional() @IsUUID('all') travellerId?: string;
  @IsOptional() @IsIn(documentTypes) documentType?: DocumentType;
  @IsOptional() @IsIn(['UPLOADED', 'PROCESSING', 'READY', 'REVIEW_REQUIRED']) status?: 'UPLOADED' | 'PROCESSING' | 'READY' | 'REVIEW_REQUIRED';
}
export class DocumentAccessDto { @IsOptional() @IsIn(['true', 'false']) download?: 'true' | 'false' }
