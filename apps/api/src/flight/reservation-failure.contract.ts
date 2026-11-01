import type {FlightOffer} from '@flyseri/types';

/** Classify a saved provider diagnostic without exposing its free-text payload.
 * This explains a failed sell; it does not resolve the reservation's outcome. */
export function reservationFailureMessage(event:string|null|undefined,bookingId:string,offer:FlightOffer):string|undefined {
  const prefix=`flight.booking.unknown-diagnostic:${bookingId}:`;
  if(!event?.startsWith(prefix))return;
  try {
    const diagnostic=JSON.parse(event.slice(prefix.length)) as {errors?:unknown};
    if(!Array.isArray(diagnostic.errors)||!diagnostic.errors.some(error=>error&&typeof error==='object'&&error.category==='APPLICATION_ERROR'&&error.type==='UNABLE_TO_BOOK_FLIGHTS_WRONG_STATUS_CODE'))return;
    const legs=offer.multiCityLegs??[offer.outbound,...(offer.inbound?[offer.inbound]:[])];
    const flights=[...new Set(legs.flatMap(leg=>leg.segments).filter(segment=>/^[A-Z0-9]{2}$/.test(segment.marketingCarrier)&&/^\d{1,4}$/.test(segment.flightNumber)).map(segment=>segment.marketingCarrier+Number(segment.flightNumber)))];
    if(!flights.length)return;
    return `The airline did not confirm the requested seats for ${flights.join(', ')}. The displayed fare could not be secured. This attempt needs a reservation check before booking again.`;
  }catch {return;}
}
