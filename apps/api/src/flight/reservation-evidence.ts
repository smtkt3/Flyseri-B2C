import type { FlightBookingProviderView, FlightOffer } from '@flyseri/types';

export function hasIssuedTicketEvidence(view: FlightBookingProviderView | null | undefined, passengerCount: number): boolean {
  return passengerCount > 0 && view?.tickets.length === passengerCount &&
    new Set(view.tickets.map(ticket => ticket.number)).size === passengerCount &&
    view.tickets.every(ticket => /^\d{13}$/.test(ticket.number) && ticket.status === 'Issued');
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
