import type { FlightOffer } from '@flyseri/types';
import { FlightBaggageDetails, FlightServiceDetails } from './FlightFareInformation';
import './review-flight-inclusions.css';

/** Keep supplier allowances attached to their original segment when grouping by flight. */
export function ReviewFlightInclusions({offer}: {offer:FlightOffer}) {
  const segments = (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])]).flatMap(leg => leg.segments);
  return <div className="review-inclusions-list">{segments.map((segment,index) => {
    const scoped:FlightOffer = {...offer, multiCityLegs:undefined, inbound:null,
      outbound:{segments:[segment],stops:0,durationMinutes:segment.durationMinutes},
      baggageAllowances:offer.baggageAllowances?.filter(item => !item.segmentIndexes?.length || item.segmentIndexes.includes(index)).map(item => ({...item,segmentIndexes:[0]})),
      amenities:offer.amenities?.filter(item => !item.segmentIndexes?.length || item.segmentIndexes.includes(index)).map(item => ({...item,segmentIndexes:[0]})),
    };
    return <section className="review-inclusions-flight" key={index} aria-label={`Included services for ${segment.origin} to ${segment.destination}, ${segment.marketingCarrier} ${segment.flightNumber}`}>
      <header><strong>{segment.origin} <span aria-hidden="true">→</span> {segment.destination}</strong><span>{segment.marketingCarrier} {segment.flightNumber}</span></header>
      <div className="review-inclusions-content"><section className="review-inclusions-bags"><h3>Baggage allowance</h3><FlightBaggageDetails offer={scoped}/></section><section className="review-inclusions-services"><h3>Onboard services</h3><FlightServiceDetails offer={scoped}/></section></div>
    </section>;
  })}</div>;
}
