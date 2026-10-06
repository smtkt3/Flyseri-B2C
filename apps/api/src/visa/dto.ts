import { Type, Transform } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, ArrayUnique, IsArray, IsDefined, IsEmail, IsIn, IsObject, IsOptional, IsString, IsUUID, Matches, MaxLength, ValidateBy, ValidateNested } from 'class-validator';
import { validTripDate } from '../trip/dto.js';

const trim = ({ value }: { value: unknown }): unknown => typeof value === 'string' ? value.trim() : value;
const IsCalendarDate = () => ValidateBy({ name: 'isCalendarDate', validator: { validate: validTripDate } });

export class VisaAssistanceAddressDto {
  @Transform(trim) @IsString() @MaxLength(160) @Matches(/\S/) addressLine1!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) addressLine2?: string;
  @Transform(trim) @IsString() @MaxLength(100) @Matches(/\S/) city!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) region?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(24) postalCode?: string;
  @Matches(/^[A-Z]{2}$/) countryCode!: string;
}

export class VisaAssistanceApplicantDto {
  @IsUUID('all') travellerId!: string;
  @Transform(trim) @IsString() @MaxLength(100) @Matches(/\S/) firstName!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) middleName?: string;
  @Transform(trim) @IsString() @MaxLength(100) @Matches(/\S/) lastName!: string;
  @IsCalendarDate() dateOfBirth!: string;
  @IsIn(['FEMALE', 'MALE', 'X', 'UNDISCLOSED']) gender!: 'FEMALE' | 'MALE' | 'X' | 'UNDISCLOSED';
  @Matches(/^[A-Z]{2}$/) nationalityCountryCode!: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(100) birthCity?: string;
  @Matches(/^[A-Z]{2}$/) birthCountryCode!: string;
  @IsIn(['PASSPORT', 'TRAVEL_DOCUMENT', 'NATIONAL_ID']) documentType!: 'PASSPORT' | 'TRAVEL_DOCUMENT' | 'NATIONAL_ID';
  @Transform(trim) @IsString() @MaxLength(40) @Matches(/\S/) documentNumber!: string;
  @Matches(/^[A-Z]{2}$/) documentIssuingCountryCode!: string;
  @IsOptional() @IsCalendarDate() documentIssuedOn?: string;
  @IsCalendarDate() documentExpiresOn!: string;
  @IsDefined() @ValidateNested() @Type(() => VisaAssistanceAddressDto) currentAddress!: VisaAssistanceAddressDto;
  @IsDefined() @ValidateNested() @Type(() => VisaAssistanceAddressDto) permanentAddress!: VisaAssistanceAddressDto;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(120) occupation?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(160) employerOrSchool?: string;
  @IsOptional() @IsIn(['YES', 'NO', 'PREFER_TO_DISCUSS']) previousVisaRefusal?: 'YES' | 'NO' | 'PREFER_TO_DISCUSS';
  @IsOptional() @Transform(trim) @IsString() @MaxLength(1000) notes?: string;
}

export class StartVisaDto {
  @IsUUID('all') visaTypeId!: string;
  @IsArray() @ArrayMaxSize(30) @ArrayUnique() @IsUUID('all', { each: true }) travellerIds!: string[];
}
export class VisaListDto { @IsOptional() @IsUUID('all') tripId?: string }
export class VisaActionDto { @IsIn(['MARK_INCOMPLETE', 'SUBMIT_DOCUMENTS']) action!: 'MARK_INCOMPLETE' | 'SUBMIT_DOCUMENTS' }
export class LinkDocumentDto { @IsUUID('all') documentId!: string; @IsUUID('all') documentVersionId!: string }
export class SaveVisaAnswersDto {
  @IsString() @MaxLength(40) @Matches(/^(application|[0-9a-f-]{36})$/i) scope!: string;
  @IsObject() answers!: Record<string, unknown>;
}
export class SubmitVisaDto { @IsString() @MaxLength(32) declarationVersion!: string }
export class VisaAssistanceRequestDto {
  @IsUUID('all') tripId!: string;
  @IsString() @Matches(/^[A-Z]{2}$/) destinationCountryCode!: string;
  @IsString() @Matches(/^\d{4}-\d{2}-\d{2}$/) expectedTravelDate!: string;
  @IsIn(['Tourism', 'Business', 'Family visit', 'Study', 'Work', 'Transit', 'Medical', 'Other']) purpose!: string;
  @IsArray() @ArrayMinSize(1) @ArrayMaxSize(30) @ValidateNested({ each: true }) @Type(() => VisaAssistanceApplicantDto) applicants!: VisaAssistanceApplicantDto[];
  @IsOptional() @IsCalendarDate() expectedReturnDate?: string;
  @IsOptional() @Transform(trim) @IsString() @MaxLength(240) accommodationOrHost?: string;
  @Transform(trim) @IsString() @MaxLength(120) @Matches(/\S/) contactName!: string;
  @IsEmail() @MaxLength(254) contactEmail!: string;
  @IsOptional() @IsString() @MaxLength(32) contactPhone?: string;
  @IsOptional() @IsString() @MaxLength(2000) customerMessage?: string;
}

export class SaveAssistanceNoteDto { @IsString() @MaxLength(2000) customerMessage!: string }
export class SubmitAssistanceRequestDto { @IsOptional() @IsString() @MaxLength(2000) customerMessage?: string }
