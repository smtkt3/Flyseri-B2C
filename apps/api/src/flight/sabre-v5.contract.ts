import type { AppConfig } from '@flyseri/config';
import type { FlightCabin, FlightLeg, FlightOffer, FlightSegment } from '@flyseri/types';
import type { NormalizedFlightSearch } from './flight-search.js';
import { parseFlightPriceBreakdown } from './flight-price-breakdown.js';

type Row = Record<string, unknown>;
const row = (value: unknown): Row | null => value && typeof value === 'object' && !Array.isArray(value) ? value as Row : null;
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const str = (value: unknown): string | null => typeof value === 'string' ? value : null;
const num = (value: unknown): number | null => typeof value === 'number' && Number.isFinite(value) ? value : null;
const ref = (value: unknown): number | null => num(row(value)?.ref);
const airport = (value: unknown): string | null => {
  const code = str(value);
  return code && /^[A-Z]{3}$/.test(code) ? code : null;
};
const carrier = (value: unknown): string | null => {
  const code = str(value);
  return code && /^[A-Z0-9]{2,3}$/.test(code) ? code : null;
};
const amount = (value: unknown): string | null => {
  const price = num(value);
  if (price === null || price < 0 || price > 1000000000) return null;
  const decimal = String(price);
  if (!/^\d+(\.\d{1,2})?$/.test(decimal)) return null;
  const [whole, fraction = ''] = decimal.split('.');
  return `${whole}.${(fraction + '00').slice(0, 2)}`;
};
const datePlus = (date: string, days: number): string => {
  const next = new Date(`${date}T00:00:00Z`);
  next.setUTCDate(next.getUTCDate() + days);
  return next.toISOString().slice(0, 10);
};
const offsetMinutes = (time: string): number | null => {
  const match = time.match(/([+-])(\d{2}):(\d{2})$/);
  if (!match) return null;
  return (match[1] === '-' ? -1 : 1) * (Number(match[2]) * 60 + Number(match[3]));
};
function datedSegment(scheduleValue: unknown, date: string, bookingClass: string): FlightSegment | null {
  const schedule = row(scheduleValue), departure = row(schedule?.departure), arrival = row(schedule?.arrival), flight = row(schedule?.carrier);
  const equipmentCode = str(row(flight?.equipment)?.code);
  const origin = airport(departure?.airport), destination = airport(arrival?.airport);
  const marketingCarrier = carrier(flight?.marketing), operatingCarrier = carrier(flight?.operating);
  const flightNumber = num(flight?.marketingFlightNumber), elapsed = num(schedule?.elapsedTime);
  const departureTime = str(departure?.time), arrivalTime = str(arrival?.time);
  if (!origin || !destination || !marketingCarrier || !operatingCarrier || flightNumber === null || !Number.isInteger(flightNumber) ||
    elapsed === null || !Number.isInteger(elapsed) || elapsed < 0 || elapsed > 10000 ||
    !departureTime || !arrivalTime || offsetMinutes(departureTime) === null || offsetMinutes(arrivalTime) === null ||
    !/^\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(departureTime) || !/^\d{2}:\d{2}:\d{2}[+-]\d{2}:\d{2}$/.test(arrivalTime) ||
    schedule?.stopCount !== 0) return null;
  const departureAt = `${date}T${departureTime}`;
  const arrivalInstant = Date.parse(departureAt) + elapsed * 60_000;
  const arrivalLocalDate = new Date(arrivalInstant + offsetMinutes(arrivalTime)! * 60_000).toISOString().slice(0, 10);
  return { origin, destination, departureAt, arrivalAt: `${arrivalLocalDate}T${arrivalTime}`,
    marketingCarrier, operatingCarrier, flightNumber: String(flightNumber), bookingClass, durationMinutes: elapsed,
    ...(equipmentCode && /^[A-Z0-9]{2,4}$/.test(equipmentCode) ? { aircraftTypeCode: equipmentCode } : {}) };
}

const cabinFromCode = (code: unknown): FlightCabin | null => {
  if (code === 'Y') return 'ECONOMY';
  if (code === 'S' || code === 'W') return 'PREMIUM_ECONOMY';
  if (code === 'C' || code === 'J') return 'BUSINESS';
  if (code === 'F') return 'FIRST';
  return null;
};
const featureCategory = (name: string): NonNullable<FlightOffer['amenities']>[number]['category'] | null => {
  if (/wi[ -]?fi|internet|connectivity/i.test(name)) return 'WIFI';
  if (/entertainment|movies?|television|video|media/i.test(name)) return 'ENTERTAINMENT';
  if (/meals?|food|snacks?|refreshments?/i.test(name)) return 'MEALS';
  if (/baggage|bags?|luggage|personal[ -]?items?|carry[ -]?on|cabin baggage|hand baggage/i.test(name)) return 'BAGGAGE';
  return null;
};
const featureAvailability = (value: unknown): NonNullable<FlightOffer['amenities']>[number]['availability'] =>
  value === 'F' ? 'INCLUDED' : value === 'C' ? 'FOR_FEE' : value === 'N' || value === 'D' ? 'NOT_INCLUDED' : 'UNKNOWN';

/** Joins GIR descriptors and returns only compact, customer-safe fare data. */
export function mapSabreV5Offers(value: unknown, limit = 1000, multiCity = false): FlightOffer[] {
  const response = row(row(value)?.groupedItineraryResponse);
  if (!response || !Array.isArray(response.itineraryGroups) || !Array.isArray(response.scheduleDescs) || !Array.isArray(response.legDescs)) throw new Error('Unsupported BFM response');
  const schedules = new Map(array(response.scheduleDescs).map((item) => [num(row(item)?.id), item]));
  const legs = new Map(array(response.legDescs).map((item) => [num(row(item)?.id), item]));
  const allowances = new Map(array(response.baggageAllowanceDescs).map((item) => [num(row(item)?.id), item]));
  const charges = new Map(array(response.baggageChargeDescs).map((item) => [num(row(item)?.id), item]));
  const fareComponents = new Map(array(response.fareComponentDescs).map((item) => [num(row(item)?.id), item]));
  const brandFeatures = new Map(array(response.brandFeatureDescs).map((item) => [num(row(item)?.id), item]));
  const passengerDescs = new Map(array(response.passengerDescs).map((item) => [num(row(item)?.id), row(item)]));
  const offers: FlightOffer[] = [];
  for (const [groupIndex, groupValue] of array(response.itineraryGroups).entries()) {
    const group = row(groupValue);
    const descriptions = array(row(group?.groupDescription)?.legDescriptions);
    for (const itineraryValue of array(group?.itineraries)) {
      if (offers.length >= limit) return offers;
      const itinerary = row(itineraryValue);
      if (!itinerary || !Array.isArray(itinerary.legs) || itinerary.legs.length < 1 || itinerary.legs.length > 6 ||
        descriptions.length !== itinerary.legs.length) continue;
      // CERT returns HPIS for the basic shop, MIP for branded alternatives, and SPMIP for revalidation.
      for (const [priceIndex, pricingValue] of array(itinerary.pricingInformation).entries()) {
      if (offers.length >= limit) return offers;
      const pricing = row(pricingValue);
      const isNdc = pricing?.pricingSubsource === 'NDC_CONNECTOR' || pricing?.pricingSubsource === 'NDC_PLAYER';
      if (!isNdc && pricing?.pricingSubsource !== 'HPIS' && pricing?.pricingSubsource !== 'MIP' && pricing?.pricingSubsource !== 'SPMIP') continue;
      const supplierOffer = row(pricing?.offer);
      const supplierOfferId = str(supplierOffer?.offerId), ttl = num(supplierOffer?.timeToLive);
      if (isNdc && (!supplierOfferId || supplierOfferId.length > 160 || /\s/.test(supplierOfferId) || supplierOffer?.source !== 'NDC' || !ttl || ttl <= 0 || ttl > 86400)) continue;
      const fare = row(pricing.fare), total = row(fare?.totalFare);
      const totalAmount = amount(total?.totalPrice), currency = str(total?.currency);
      if (!fare || !totalAmount || !currency || !/^[A-Z]{3}$/.test(currency)) continue;
      const baseFareAmount = (total?.equivalentCurrency === currency ? amount(total?.equivalentAmount) : null)
        ?? (total?.baseFareCurrency === currency ? amount(total?.baseFareAmount) : null);
      const taxesAndFeesAmount = amount(total?.totalTaxAmount);
      const passengerPrices = array(fare.passengerInfoList).map((value) => {
        const person = row(row(value)?.passengerInfo), price = row(person?.passengerTotalFare);
        return { passengerType: person?.passengerType, count: person?.passengerNumber, currency: price?.currency,
          baseFareAmount: (price?.equivalentCurrency === currency ? amount(price?.equivalentAmount) : null)
            ?? (price?.baseFareCurrency === currency ? amount(price?.baseFareAmount) : null),
          taxesAndFeesAmount: amount(price?.totalTaxAmount), totalAmount: amount(price?.totalFare) };
      });
      const priceBreakdown = parseFlightPriceBreakdown({ baseFareAmount, taxesAndFeesAmount, currency, passengerPrices }, totalAmount, currency);
      const passengerInfo = row(row(array(fare.passengerInfoList).find((item) => row(row(item)?.passengerInfo)?.passengerType === 'ADT'))?.passengerInfo);
      const ndcPassengers: NonNullable<FlightOffer['ndcContext']>['passengers'] = [];
      const ndcOfferItemIds: string[] = [];
      if (isNdc) for (const value of array(fare.passengerInfoList)) {
        const info = row(row(value)?.passengerInfo);
        const offerItemId = str(info?.offerItemId);
        if (offerItemId && offerItemId.length <= 160 && !/\s/.test(offerItemId) && !ndcOfferItemIds.includes(offerItemId)) ndcOfferItemIds.push(offerItemId);
        const passengerTypeCode = str(info?.passengerType);
        if (passengerTypeCode !== 'ADT' && passengerTypeCode !== 'CNN' && passengerTypeCode !== 'INF') continue;
        for (const passenger of array(info?.passengers)) {
          const passengerId = str(passengerDescs.get(ref(passenger))?.passengerId);
          if (passengerId && passengerId.length <= 160 && !/\s/.test(passengerId) && !ndcPassengers.some((item) => item.passengerId === passengerId))
            ndcPassengers.push({ passengerId, passengerTypeCode });
        }
      }
      const components = array(passengerInfo?.fareComponents).map(row);
      const pricedSegments = components.flatMap((component) => array(component?.segments).map((segment) => row(row(segment)?.segment)));
      const bookingCodes = pricedSegments.map((segment) => str(segment?.bookingCode));
      if (!bookingCodes.length || bookingCodes.some((code) => !code || !/^[A-Z0-9]{1,2}$/.test(code))) continue;
      const mappedLegs: FlightLeg[] = [];
      let bookingIndex = 0;
      for (let legIndex = 0; legIndex < itinerary.legs.length; legIndex++) {
        const leg = row(legs.get(ref(itinerary.legs[legIndex]))), description = row(descriptions[legIndex]);
        const departureDate = str(description?.departureDate);
        const legSchedules = array(leg?.schedules);
        if (!departureDate || !/^\d{4}-\d{2}-\d{2}$/.test(departureDate) || !legSchedules.length || legSchedules.length > 10) break;
        const segments: FlightSegment[] = [];
        for (const scheduleRef of legSchedules) {
          const pricedSegment = pricedSegments[bookingIndex];
          const adjustment = row(scheduleRef)?.departureDateAdjustment ?? 0;
          const bookingClass = bookingCodes[bookingIndex++];
          if (typeof adjustment !== 'number' || !Number.isInteger(adjustment) || Math.abs(adjustment) > 3 || !bookingClass) break;
          const segment = datedSegment(schedules.get(ref(scheduleRef)), datePlus(departureDate, adjustment), bookingClass);
          if (!segment) break;
          const seatsAvailable = num(pricedSegment?.seatsAvailable);
          if (seatsAvailable !== null && Number.isInteger(seatsAvailable) && seatsAvailable >= 0 && seatsAvailable <= 999)
            segment.seatsAvailable = seatsAvailable;
          segments.push(segment);
        }
        if (segments.length !== legSchedules.length) break;
        const elapsed = num(leg?.elapsedTime);
        mappedLegs.push({ segments, stops: segments.length - 1, durationMinutes: elapsed !== null && Number.isInteger(elapsed) ? elapsed : null });
      }
      if (mappedLegs.length !== itinerary.legs.length || bookingIndex !== bookingCodes.length) continue;
      const baggageRows = array(passengerInfo?.baggageInformation).map(row).filter((item): item is Row => item !== null);
      const baggageAllowances: NonNullable<FlightOffer['baggageAllowances']> = baggageRows.filter((item) => item.provisionType === 'A' || item.provisionType === 'B').flatMap((item) => {
        const allowance = row(allowances.get(ref(item.allowance)));
        if (!allowance) return [];
        const pieces = num(allowance.pieceCount), weight = num(allowance.weight), unit = str(allowance.unit);
        const piecesLabel = pieces !== null && Number.isInteger(pieces) ? `${pieces} ${pieces === 1 ? 'piece' : 'pieces'}` : null;
        const weightLabel = weight !== null && unit && /^[a-zA-Z]{1,10}$/.test(unit) ? `${weight} ${unit.toLowerCase()}` : null;
        const description = [piecesLabel, weightLabel].filter(Boolean).join(' · ') ||
          [str(allowance.description1), str(allowance.description2)].filter(Boolean).join(' · ').slice(0, 120) || null;
        const hasAllowance = (pieces !== null && pieces > 0) || (weight !== null && weight > 0);
        const explicitlyEmpty = pieces === 0 || weight === 0;
        const segmentIndexes = [...new Set(array(item.segments).map((segment) => num(row(segment)?.id))
          .filter((index): index is number => index !== null && Number.isInteger(index) && index >= 0 && index < 60))];
        return [{ type: item.provisionType === 'A' ? 'CHECKED' as const : 'CARRY_ON' as const,
          availability: hasAllowance ? 'INCLUDED' as const : explicitlyEmpty ? 'NOT_INCLUDED' as const : 'UNKNOWN' as const,
          description, segmentIndexes }];
      });
      const chargeRow = baggageRows.filter((item) => typeof item.provisionType === 'string' && item.provisionType.startsWith('C'))
        .map((item) => row(charges.get(ref(row(item)?.charge)))).find((item) => item !== null);
      const chargeAmount = amount(chargeRow?.equivalentAmount), chargeCurrency = str(chargeRow?.equivalentCurrency);
      const baggageCharge = chargeAmount && chargeCurrency && /^[A-Z]{3}$/.test(chargeCurrency)
        ? { amount: chargeAmount, currency: chargeCurrency,
          description: str(chargeRow?.description1)?.slice(0, 100) ?? null } : null;
      const cabins = [...new Set(pricedSegments.map((segment) => cabinFromCode(segment?.cabinCode)).filter((item) => item !== null))];
      const cabin = cabins.length === 1 ? cabins[0]! : cabins.length > 1 ? 'MIXED' : null;
      const brands = components.map((component) => row(row(fareComponents.get(ref(component)))?.brand));
      const brandNames = [...new Set(brands.map((brand) => str(brand?.brandName)).filter((name): name is string => !!name && name.length <= 80))];
      const brandCodes = [...new Set(brands.map((brand) => str(brand?.code)).filter((code): code is string => !!code && code.length <= 12))];
      const fareBrand = brandNames.length === 1 ? brandNames[0]! : brandNames.length > 1 ? 'Mixed fare brands' : null;
      const fareBrandCode = brandCodes.length === 1 ? brandCodes[0]! : null;
      const amenities: NonNullable<FlightOffer['amenities']> = [];
      let featureOffset = 0;
      for (const component of components) {
        const segmentIndexes = array(component?.segments).map((_, index) => featureOffset + index);
        featureOffset += segmentIndexes.length;
        for (const featureRef of array(component?.brandFeatures)) {
        const descriptor = row(brandFeatures.get(ref(featureRef)));
        const name = str(descriptor?.commercialName)?.trim();
        if (!name || name.length > 80) continue;
        const category = featureCategory(name);
        if (!category || !segmentIndexes.length || amenities.length >= 720) continue;
        const availability = featureAvailability(descriptor?.application);
        const existing = amenities.find((item) => item.category === category && item.name === name && item.availability === availability);
        if (existing) existing.segmentIndexes = [...new Set([...(existing.segmentIndexes ?? []), ...segmentIndexes])];
        else amenities.push({ category, name, availability, segmentIndexes });
        }
      }
      for (const feature of amenities.filter((item) => item.category === 'BAGGAGE')) {
        const type = /personal[ -]?item/i.test(feature.name) ? 'PERSONAL_ITEM' as const
          : /carry[ -]?on|cabin baggage|hand baggage/i.test(feature.name) ? 'CARRY_ON' as const
            : /checked baggage|checked bag/i.test(feature.name) ? 'CHECKED' as const : null;
        const uncovered = (feature.segmentIndexes ?? []).filter((index) => !baggageAllowances.some((item) => item.type === type && item.availability !== 'UNKNOWN' &&
          (!item.segmentIndexes.length || item.segmentIndexes.includes(index))));
        if (type && uncovered.length) {
          baggageAllowances.push({ type, availability: feature.availability, description: feature.name, segmentIndexes: uncovered });
        }
      }
      const checkedLabels = mappedLegs.flatMap((leg) => leg.segments).map((_, index) => {
        const applicable = baggageAllowances.filter((item) => item.type === 'CHECKED' &&
          (!item.segmentIndexes.length || item.segmentIndexes.includes(index)));
        const known = applicable.filter((item) => item.availability !== 'UNKNOWN');
        const details = known.length ? known : applicable;
        return [...new Set(details.map((item) => item.availability === 'NOT_INCLUDED' ? 'No checked baggage included'
          : item.availability === 'FOR_FEE' ? 'Checked baggage available for a fee'
          : item.availability === 'INCLUDED' ? (item.description ? item.description + ' checked baggage included' : 'Checked baggage included')
          : 'Checked baggage allowance not specified'))].join(' / ') || null;
      });
      const baggageSummary = checkedLabels.every((label) => label === null) ? null
        : checkedLabels.every((label) => label === checkedLabels[0]) ? checkedLabels[0]!
          : 'Checked baggage varies by flight';
      const penalties = array(row(passengerInfo?.penaltiesInfo)?.penalties).flatMap((value) => {
        const penalty = row(value);
        if (!penalty || (penalty.type !== 'Refund' && penalty.type !== 'Exchange') ||
          (penalty.applicability !== 'Before' && penalty.applicability !== 'After')) return [];
        const allowed = penalty.type === 'Refund' ? penalty.refundable : penalty.changeable;
        if (typeof allowed !== 'boolean') return [];
        const rawAmount = amount(penalty.amount), rawCurrency = str(penalty.currency);
        const validCurrency = rawCurrency && /^[A-Z]{3}$/.test(rawCurrency) ? rawCurrency : null;
        const validAmount = rawAmount && (validCurrency || rawAmount === '0.00') ? rawAmount : null;
        return [{ type: penalty.type === 'Refund' ? 'REFUND' as const : 'CHANGE' as const,
          applicability: penalty.applicability === 'Before' ? 'BEFORE' as const : 'AFTER' as const,
          allowed, amount: validAmount, currency: validAmount ? validCurrency : null }];
      }).slice(0, 4);
      const nonRefundable = typeof passengerInfo?.nonRefundable === 'boolean' ? passengerInfo.nonRefundable : null;
      const airlineCodes = [...new Set(mappedLegs.flatMap((leg) => leg.segments.map((segment) => segment.marketingCarrier)))];
      offers.push({ offerId: `${itinerary.id}:${priceIndex}`, itineraryKey: `${groupIndex}:${itinerary.id}`,
        ...(isNdc ? { ndcContext: { offerId: supplierOfferId!, offerItemIds: ndcOfferItemIds, expiresAt: new Date(Date.now() + ttl! * 1000).toISOString(), passengers: ndcPassengers } } : {}),
        outbound: mappedLegs[0]!, inbound: mappedLegs[1] ?? null,
        ...(multiCity ? { multiCityLegs: mappedLegs } : {}),
        totalAmount, currency, ...(priceBreakdown && { priceBreakdown }), airlineCodes, baggageSummary, baggageAllowances, penalties, nonRefundable,
        baggageCharge, cabin, fareBrand, fareBrandCode, amenities });
      }
    }
  }
  return offers;
}

const passengerTypes = (search: NormalizedFlightSearch) => [
  search.adults && { Code: 'ADT', Quantity: search.adults },
  search.children && { Code: 'CNN', Quantity: search.children },
  search.infants && { Code: 'INF', Quantity: search.infants },
].filter(Boolean);
const pos = (pcc: string) => ({ Source: [{ PseudoCityCode: pcc, RequestorID: { Type: '1', ID: '1', CompanyName: { Code: 'TN' } } }] });
const cabin = { ECONOMY: 'Y', PREMIUM_ECONOMY: 'S', BUSINESS: 'C', FIRST: 'F' } as const;

/** Exact REST v5 OTA request shape from Sabre's public OpenAPI. */
export function buildSabreBfmV5Request(search: NormalizedFlightSearch, config: Pick<AppConfig, 'SABRE_PCC'>, mode: 'branded' | 'cabins' = 'branded'): unknown {
  if (!config.SABRE_PCC) throw new Error('Sabre PCC missing');
  const destinations = search.tripType === 'MULTI_CITY' && search.legs ? search.legs
    : [{ date: search.departureDate, from: search.origin, to: search.destination },
      ...(search.tripType === 'ROUND_TRIP' && search.returnDate ? [{ date: search.returnDate, from: search.destination, to: search.origin }] : [])];
  return { OTA_AirLowFareSearchRQ: { Version: '5', POS: pos(config.SABRE_PCC),
    OriginDestinationInformation: destinations.map((item) => {
      const date = 'date' in item ? item.date : item.departureDate;
      const from = 'from' in item ? item.from : item.origin;
      const to = 'to' in item ? item.to : item.destination;
      return { DepartureDateTime: `${date}T00:00:00`, OriginLocation: { LocationCode: from }, DestinationLocation: { LocationCode: to } };
    }),
    TravelPreferences: { CabinPref: [{ Cabin: cabin[search.cabin], PreferLevel: 'Preferred' }],
      TPA_Extensions: { DataSources: { NDC: 'Enable', ATPCO: 'Enable', LCC: 'Disable' },
        ...(mode === 'branded' ? { NDCIndicators: { MultipleBrandedFares: { Value: true } } }
          : { FlexibleFares: { FareParameters: Object.values(cabin).map((code) => ({ Cabin: { Type: code } })) } }) },
      Baggage: { RequestType: 'A', Description: true, CarryOnInfo: true } },
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: passengerTypes(search) }],
      PriceRequestInformation: { CurrencyCode: search.currency, TPA_Extensions: {
        ...(mode === 'branded' ? { BrandedFareIndicators: { MultipleBrandedFares: true, ReturnBrandAncillaries: true, UpsellLimit: 9 } } : {}),
      } } },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  } };
}

export function buildSabreRevalidateV5Request(offer: FlightOffer, search: NormalizedFlightSearch, pcc: string): unknown {
  const legs = offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])];
  const expectedLegCount = search.tripType === 'ROUND_TRIP' ? 2 : search.tripType === 'MULTI_CITY' ? search.legs?.length : 1;
  if (!pcc || legs.length !== expectedLegCount) throw new Error('Invalid revalidation itinerary');
  return { OTA_AirLowFareSearchRQ: { Version: '5', POS: pos(pcc),
    OriginDestinationInformation: legs.map((leg) => {
      const first = leg.segments[0]!, last = leg.segments.at(-1)!;
      if (!leg.segments.length || leg.segments.some((segment) => !segment.bookingClass || !segment.operatingCarrier)) throw new Error('Booking class unavailable');
      return { Fixed: false, DepartureDateTime: first.departureAt.slice(0, 19),
        OriginLocation: { LocationCode: first.origin }, DestinationLocation: { LocationCode: last.destination },
        TPA_Extensions: { Flight: leg.segments.map((segment) => ({ Type: 'A', Number: Number(segment.flightNumber),
          DepartureDateTime: segment.departureAt.slice(0, 19), ArrivalDateTime: segment.arrivalAt.slice(0, 19),
          ClassOfService: segment.bookingClass, OriginLocation: { LocationCode: segment.origin }, DestinationLocation: { LocationCode: segment.destination },
          Airline: { Marketing: segment.marketingCarrier, Operating: segment.operatingCarrier } })) } };
    }),
    TravelPreferences: { TPA_Extensions: { VerificationItinCallLogic: { Value: 'L' } } },
    TravelerInfoSummary: { AirTravelerAvail: [{ PassengerTypeQuantity: passengerTypes(search) }], PriceRequestInformation: {
      CurrencyCode: offer.currency, TPA_Extensions: { BrandedFareIndicators: { SingleBrandedFare: true, ReturnBrandAncillaries: true } },
    } },
    TPA_Extensions: { IntelliSellTransaction: { RequestType: { Name: '50ITINS' } } },
  } };
}

