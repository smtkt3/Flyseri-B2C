import type { FlightBookingProviderView, FlightExchangeQuotation, OrderOverview, OrderSummary } from '@flyseri/types';
import { parseFlightOffers } from '../flight/flight-response.js';
import { hasCurrentIssuedTicketEvidence } from '../flight/reservation-evidence.js';

type Item = { itemType: string; descriptionSnapshot: string; quantity: number };
export interface OrderOverviewBooking {
  status: string;
  pnr: string | null;
  offer: unknown;
  search: unknown;
  passengerNames: unknown;
  providerView: unknown;
}
export interface OrderOverviewVisa {
  destinationCountryCode: string;
  travelDate: string | null;
  reference: string | null;
  travelerCount?: number;
}
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const count = (value: unknown) => Number.isInteger(value) && Number(value) > 0 && Number(value) <= 9 ? Number(value) : undefined;
const date = (value: unknown) => typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value) && Number.isFinite(Date.parse(value)) ? value : undefined;

/** Only saved customer-owned data is mapped here; listing orders never calls a supplier. */
export function orderOverview(order: Pick<OrderSummary, 'status' | 'bookingIntentId' | 'flightServicingCaseId' | 'visaApplicationId'>,
  items: Item[], booking?: OrderOverviewBooking, visa?: OrderOverviewVisa, exchange?: FlightExchangeQuotation): OrderOverview {
  const fallback = items.find(item => item.itemType !== 'SERVICE_FEE')?.descriptionSnapshot ?? items[0]?.descriptionSnapshot ?? 'Order details';
  const overview: OrderOverview = { kind: order.flightServicingCaseId ? 'FLIGHT_EXCHANGE' : order.bookingIntentId ? 'FLIGHT' : order.visaApplicationId || items.some(item => item.itemType === 'VISA_SERVICE') ? 'VISA' : 'OTHER', title: fallback };
  if (overview.kind === 'VISA') {
    if (visa) {
      overview.destinationCountryCode = visa.destinationCountryCode;
      overview.travelDate = date(visa.travelDate);
      overview.travelerCount = count(visa.travelerCount);
      if (visa.reference) overview.reference = { label: 'Application', value: visa.reference };
    }
    return overview;
  }
  if (overview.kind !== 'FLIGHT' && overview.kind !== 'FLIGHT_EXCHANGE') return overview;
  if (overview.kind === 'FLIGHT_EXCHANGE') overview.title = 'Flight change';
  const search = object(booking?.search);
  const offer = parseFlightOffers([booking?.offer])?.[0];
  if (exchange) {
    overview.journeys = exchange.flights.map(flight => ({ origin: flight.origin, destination: flight.destination, departureDate: flight.departureDate }));
    overview.airlineCodes = [...new Set(exchange.flights.map(flight => flight.airline))];
  } else if (offer && overview.kind === 'FLIGHT') {
    overview.journeys = (offer.multiCityLegs ?? [offer.outbound, ...(offer.inbound ? [offer.inbound] : [])]).map(leg => ({
      origin: leg.segments[0]!.origin, destination: leg.segments.at(-1)!.destination, departureDate: leg.segments[0]!.departureAt.slice(0, 10),
    }));
    overview.airlineCodes = offer.airlineCodes;
  }
  if (overview.journeys?.length) overview.title = overview.journeys.map(leg => `${leg.origin} → ${leg.destination}`).join(' · ');
  overview.travelDate = overview.journeys?.[0]?.departureDate;
  overview.cabin = offer?.cabin;
  if (['ONE_WAY', 'ROUND_TRIP', 'MULTI_CITY'].includes(String(search.tripType))) overview.tripType = search.tripType as OrderOverview['tripType'];
  const names = booking?.passengerNames;
  overview.travelerCount = count(Array.isArray(names) ? names.length : undefined) ?? count(Array.isArray(search.checkoutTravellerOrder) ? search.checkoutTravellerOrder.length : undefined) ?? count(Number(search.adults ?? 0) + Number(search.children ?? 0) + Number(search.infants ?? 0));
  overview.extrasCount = items.filter(item => item.itemType === 'FLIGHT' && item.descriptionSnapshot.startsWith('Airline extra:')).length;
  if (booking) {
    overview.bookingStatus = booking.status;
    overview.ticketIssued = false;
    if (order.status === 'PAID' && booking.pnr && /^[A-Z0-9]{6,16}$/.test(booking.pnr)) overview.reference = { label: 'PNR', value: booking.pnr };
    const view = object(booking.providerView);
    // Old or incomplete snapshots must not become an issued-ticket claim.
    if (booking.status === 'TICKETED' && Array.isArray(view.tickets) && view.tickets.every(ticket => ticket && typeof ticket === 'object')) {
      try { overview.ticketIssued = hasCurrentIssuedTicketEvidence(view as unknown as FlightBookingProviderView, overview.travelerCount ?? 0); } catch { overview.ticketIssued = false; }
    }
  }
  return overview;
}
