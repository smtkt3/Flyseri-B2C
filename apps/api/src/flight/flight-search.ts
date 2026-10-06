import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';
import { Transform, Type } from 'class-transformer';
import { ArrayMaxSize, ArrayMinSize, IsArray, IsIn, IsInt, IsOptional, IsUUID, Matches, Max, Min, ValidateBy, ValidateNested } from 'class-validator';
import type { AppConfig } from '@flyseri/config';
import type { FlightCabin, FlightSearchRequest, FlightTripType } from '@flyseri/types';
import { validTripDate } from '../trip/dto.js';

const upper = ({ value }: { value: unknown }) => typeof value === 'string' ? value.trim().toUpperCase() : value;
const validDate = () => ValidateBy({ name: 'flightDate', validator: { validate: validTripDate } });
const cabins: FlightCabin[] = ['ECONOMY', 'PREMIUM_ECONOMY', 'BUSINESS', 'FIRST'];
const tripTypes: FlightTripType[] = ['ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'];

class FlightSearchLegDto {
  @Transform(upper) @Matches(/^[A-Z]{3}$/) origin!: string;
  @Transform(upper) @Matches(/^[A-Z]{3}$/) destination!: string;
  @validDate() departureDate!: string;
}

export class FlightSearchDto implements FlightSearchRequest {
  @Transform(upper) @Matches(/^[A-Z]{3}$/) origin!: string;
  @Transform(upper) @Matches(/^[A-Z]{3}$/) destination!: string;
  @validDate() departureDate!: string;
  @IsOptional() @validDate() returnDate?: string;
  @IsIn(tripTypes) tripType!: FlightTripType;
  @IsOptional() @IsArray() @ArrayMinSize(2) @ArrayMaxSize(6) @ValidateNested({ each: true }) @Type(() => FlightSearchLegDto) legs?: FlightSearchLegDto[];
  @IsInt() @Min(1) @Max(9) adults!: number;
  @IsInt() @Min(0) @Max(8) children!: number;
  @IsInt() @Min(0) @Max(8) infants!: number;
  @IsIn(cabins) cabin!: FlightCabin;
  @Transform(upper) @Matches(/^[A-Z]{3}$/) currency!: string;
  @IsOptional() @IsUUID() tripId?: string;
}

export type NormalizedFlightSearch = Omit<FlightSearchRequest, 'tripId'>;
export function normalizeFlightSearch(input: FlightSearchRequest): NormalizedFlightSearch {
  const search: NormalizedFlightSearch = {
    origin: input.origin.trim().toUpperCase(), destination: input.destination.trim().toUpperCase(),
    departureDate: input.departureDate, tripType: input.tripType,
    adults: input.adults, children: input.children, infants: input.infants,
    cabin: input.cabin, currency: input.currency.trim().toUpperCase(),
  };
  if (input.tripType === 'ROUND_TRIP' && input.returnDate) search.returnDate = input.returnDate;
  if (input.tripType === 'MULTI_CITY' && input.legs) search.legs = input.legs.map((leg) => ({
    origin: leg.origin.trim().toUpperCase(), destination: leg.destination.trim().toUpperCase(), departureDate: leg.departureDate,
  }));
  const validMultiCity = search.tripType !== 'MULTI_CITY' || (!!search.legs && search.legs.length >= 2 && search.legs.length <= 6 &&
    search.legs.every((leg, index) => /^[A-Z]{3}$/.test(leg.origin) && /^[A-Z]{3}$/.test(leg.destination) && leg.origin !== leg.destination && validTripDate(leg.departureDate) &&
      (!index || (search.legs![index - 1]!.destination === leg.origin && search.legs![index - 1]!.departureDate <= leg.departureDate))) &&
    search.origin === search.legs[0]!.origin && search.destination === search.legs.at(-1)!.destination && search.departureDate === search.legs[0]!.departureDate);
  if (!/^[A-Z]{3}$/.test(search.origin) || !/^[A-Z]{3}$/.test(search.destination) || (search.tripType !== 'MULTI_CITY' && search.origin === search.destination) ||
      !/^[A-Z]{3}$/.test(search.currency) || !validTripDate(search.departureDate) ||
      (search.returnDate !== undefined && (!validTripDate(search.returnDate) || search.returnDate < search.departureDate)) ||
      (search.tripType === 'ROUND_TRIP' && !search.returnDate) || (search.tripType !== 'ROUND_TRIP' && input.returnDate !== undefined) ||
      (search.tripType === 'MULTI_CITY' ? !validMultiCity : input.legs !== undefined) ||
      !tripTypes.includes(search.tripType) || !cabins.includes(search.cabin) ||
      ![search.adults, search.children, search.infants].every(Number.isInteger) || search.adults < 1 ||
      search.children < 0 || search.infants < 0 || search.infants > search.adults ||
      search.adults + search.children + search.infants > 9) throw new BadRequestException('Check your flight search and try again.');
  return search;
}

export function flightSearchHash(search: NormalizedFlightSearch, config: Pick<AppConfig, 'SABRE_ENV' | 'SABRE_PCC' | 'SABRE_SHOPPING_POLICY_VERSION'>): string {
  const canonical = JSON.stringify({ provider: 'sabre', endpoint: 'bfm_v5', responseProfile: 'all-cabins-branded-fares-v5-passenger-prices', policy: config.SABRE_SHOPPING_POLICY_VERSION,
    environment: config.SABRE_ENV, agency: config.SABRE_PCC, search });
  return createHash('sha256').update(canonical).digest('hex');
}
