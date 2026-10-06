import type { FlightBaggageAllowance, FlightOffer } from '@flyseri/types';
import { FlightMealDetails } from './FlightMealDetails';

const segmentsOf = (offer: FlightOffer) => (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])]).flatMap((leg) => leg.segments);
const status = { INCLUDED: 'Included', FOR_FEE: 'Available for a fee', NOT_INCLUDED: 'Not included', UNKNOWN: 'Not specified by airline' };
const bagNames = { PERSONAL_ITEM: 'Personal item', CARRY_ON: 'Carry-on baggage', CHECKED: 'Checked baggage' };
const applies = (indexes: number[] | undefined, index: number) => !indexes?.length || indexes.includes(index);
const unique = (values: string[]) => [...new Set(values)].join(' / ');
const baggageTypeNames: Record<FlightBaggageAllowance['type'], string> = { PERSONAL_ITEM: 'Personal item', CARRY_ON: 'Carry-on baggage', CHECKED: 'Checked baggage' };
const baggageIcon: Record<FlightBaggageAllowance['type'], string> = { PERSONAL_ITEM: '↗', CARRY_ON: '↑', CHECKED: '✓' };
const bagLabel = (item: FlightBaggageAllowance) => item.description
  ? `${status[item.availability]} · ${item.description}` : status[item.availability];

export function hasIncludedCheckedBaggage(offer: FlightOffer, legIndex: number) {
  const legs = offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])];
  const offset = legs.slice(0, legIndex).reduce((sum, leg) => sum + leg.segments.length, 0);
  return !!legs[legIndex]?.segments.length && legs[legIndex]!.segments.every((_, position) => {
    const bags = (offer.baggageAllowances ?? []).filter((item) => item.type === 'CHECKED' && item.availability !== 'UNKNOWN' && applies(item.segmentIndexes, offset + position));
    return bags.length > 0 && bags.every((item) => item.availability === 'INCLUDED');
  });
}

export const hasKnownBaggage = (offer: FlightOffer) => (offer.baggageAllowances ?? []).some(item => item.availability !== 'UNKNOWN');
export const hasKnownServices = (offer: FlightOffer) => (offer.amenities ?? []).some(item => item.category !== 'BAGGAGE' && item.availability !== 'UNKNOWN');

export function FlightBaggageDetails({ offer, knownOnly = false, legIndex }: { offer: FlightOffer; knownOnly?: boolean; legIndex?: number }) {
  const legs = offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])];
  const start = legIndex === undefined ? 0 : legs.slice(0, legIndex).reduce((sum, leg) => sum + leg.segments.length, 0);
  const end = legIndex === undefined ? Infinity : start + (legs[legIndex]?.segments.length ?? 0);
  return <>{segmentsOf(offer).map((segment, index) => {
    if (index < start || index >= end) return null;
    if (knownOnly && !(offer.baggageAllowances ?? []).some(item => item.availability !== 'UNKNOWN' && applies(item.segmentIndexes, index))) return null;
    return <div className={`flight-fare-baggage-leg${knownOnly ? '' : ' flight-baggage-allowance-leg'}`} key={index}>
    {(!knownOnly || segmentsOf(offer).length > 1) && <strong className="flight-fare-baggage-direction">{segment.origin} <span aria-hidden="true">→</span> {segment.destination}<small>{segment.marketingCarrier} {segment.flightNumber}</small></strong>}
    {(Object.keys(bagNames) as FlightBaggageAllowance['type'][]).map((type) => {
      const applicable = (offer.baggageAllowances ?? []).filter((item) => item.type === type && applies(item.segmentIndexes, index));
      const known = applicable.filter((item) => item.availability !== 'UNKNOWN');
      if (knownOnly && !known.length) return null;
      const bags = known.length ? known : applicable;
      const labels = bags.map(bagLabel);
      const availability = bags.length && bags.every(item => item.availability === bags[0]!.availability) ? bags[0]!.availability : 'UNKNOWN';
      return <div className="flight-baggage-allowance-row" key={type}>
        <span className="flight-baggage-allowance-icon" aria-hidden="true">{baggageIcon[type]}</span>
        <span className="flight-baggage-allowance-name">{baggageTypeNames[type]}:</span>
        <strong className={`flight-baggage-allowance-value is-${availability.toLowerCase().replace('_', '-')}`}>{bags.length ? unique(labels) : 'Not specified by airline'}</strong>
      </div>;
    })}
  </div>;
  })}</>;
}

export function FlightServiceDetails({ offer, knownOnly = false }: { offer: FlightOffer; knownOnly?: boolean }) {
  return <><FlightMealDetails offer={offer} knownOnly={knownOnly} />{segmentsOf(offer).map((segment, index) => {
    const features = (offer.amenities ?? []).filter((item) => item.category !== 'BAGGAGE' && item.category !== 'MEALS' && applies(item.segmentIndexes, index) && (!knownOnly || item.availability !== 'UNKNOWN'));
    if (!features.length) return null;
    return <div className="flight-fare-baggage-leg" key={index}>
      {(!knownOnly || segmentsOf(offer).length > 1) && <strong className="flight-fare-baggage-direction">{segment.origin} → {segment.destination} · {segment.marketingCarrier} {segment.flightNumber}</strong>}
      {features.map((item, featureIndex) => <p key={featureIndex}>{item.name}: <strong>{status[item.availability]}</strong></p>)}
    </div>;
  })}</>;
}
