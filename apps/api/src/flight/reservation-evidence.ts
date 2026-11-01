import type { FlightBookingProviderView, FlightOffer } from '@flyseri/types';

/** Sabre can keep document status Issued after every original coupon is exchanged. */
export function hasExchangedCouponEvidence(ticket:FlightBookingProviderView['tickets'][number]):boolean {
  return ['Issued','Refunded/Exchanged'].includes(ticket.status)&&Boolean(ticket.couponStatuses?.length)&&ticket.couponStatuses!.every(status=>status==='Exchanged');
}

export function hasIssuedTicketEvidence(view: FlightBookingProviderView | null | undefined, passengerCount: number): boolean {
  return passengerCount > 0 && view?.tickets.length === passengerCount &&
    new Set(view.tickets.map(ticket => ticket.number)).size === passengerCount &&
    new Set(view.tickets.map(ticket => ticket.travellerIndex)).size === passengerCount &&
    view.tickets.every(ticket => /^\d{13}$/.test(ticket.number) && ticket.status === 'Issued' &&
      !ticket.couponStatuses?.some(status=>['Exchanged','Refunded','Voided'].includes(status)) &&
      Number.isInteger(ticket.travellerIndex) && ticket.travellerIndex! >= 1 && ticket.travellerIndex! <= passengerCount);
}

/** Historical exchanged coupons may coexist with the current issued tickets. */
export function hasCurrentIssuedTicketEvidence(view:FlightBookingProviderView|null|undefined,passengerCount:number):boolean{
  if(!view)return false;
  const historical=view.tickets.filter(hasExchangedCouponEvidence);
  const current=view.tickets.filter(ticket=>!historical.includes(ticket));
  return new Set(view.tickets.map(ticket=>ticket.number)).size===view.tickets.length&&hasIssuedTicketEvidence({...view,tickets:current},passengerCount);
}

/** A matching flight number alone does not establish an unchanged, confirmed itinerary. */
export function matchesConfirmedItinerary(view: FlightBookingProviderView, offer: FlightOffer): boolean {
  const segments = (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])]).flatMap(leg => leg.segments);
  return segments.length > 0 && view.flights.length === segments.length && view.flights.every((flight, index) => {
    const segment = segments[index]!;
    return flight.status === 'Confirmed' && flight.origin === segment.origin && flight.destination === segment.destination &&
      flight.airlineCode === segment.marketingCarrier && Number(flight.flightNumber) === Number(segment.flightNumber) &&
      flight.departureDate === segment.departureAt.slice(0, 10) && flight.departureTime.slice(0, 5) === segment.departureAt.slice(11, 16) &&
      flight.arrivalDate === segment.arrivalAt.slice(0, 10) && flight.arrivalTime.slice(0, 5) === segment.arrivalAt.slice(11, 16);
  });
}
