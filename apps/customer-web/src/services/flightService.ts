import type { FlightAncillaryResponse, FlightBooking, FlightReservationInput, FlightBookingIntent, FlightBookingIntentInput, FlightSearchRequest, FlightSearchResponse, FlightSearchEvent, PopularCachedFlightFare } from '@flyseri/types';
import { apiClient, ApiClientError, type RequestOptions } from '../lib/api/client';
import {flightSearchPerformance} from '../flight/flightSearchPerformance';

export const flightService = {
  async ancillaryDisplayPrices(prices: { amount: string | null; currency: string | null }[], currency: string): Promise<import('@flyseri/types').FlightAncillaryDisplayPrices> {
    return (await apiClient.post<import('@flyseri/types').FlightAncillaryDisplayPrices>('/flights/ancillary-display-prices', { prices, currency }, { anonymous: true, timeoutMs: 12000 })).data;
  },
  async popularCachedFares(): Promise<PopularCachedFlightFare[]> { return (await apiClient.get<PopularCachedFlightFare[]>('/flights/popular-cached-fares')).data; },
  async ancillaries(input: { searchId: string; offerId: string; passengers: { givenName: string; surname: string }[] }): Promise<FlightAncillaryResponse> {
    return (await apiClient.post<FlightAncillaryResponse>('/flights/ancillaries', input, { timeoutMs: 40000 })).data;
  },
  async reviewExtras(id: string, refresh = false): Promise<import('@flyseri/types').FlightAncillaryPurchase | undefined> { return (await apiClient.post<import('@flyseri/types').FlightAncillaryPurchase>('/flights/bookings/' + encodeURIComponent(id) + '/extras/review', {refresh}, {timeoutMs: 60000})).data; },
  async confirmExtras(id: string, reviewId: string): Promise<import('@flyseri/types').FlightAncillaryPurchase> { return (await apiClient.post<import('@flyseri/types').FlightAncillaryPurchase>('/flights/bookings/' + encodeURIComponent(id) + '/extras/confirm', {reviewId}, {timeoutMs: 60000})).data; },
  async skipExtras(id: string): Promise<import('@flyseri/types').FlightAncillaryPurchase> { return (await apiClient.post<import('@flyseri/types').FlightAncillaryPurchase>('/flights/bookings/' + encodeURIComponent(id) + '/extras/skip', undefined)).data; },
  async reconcileExtras(id: string): Promise<import('@flyseri/types').FlightAncillaryPurchase> { return (await apiClient.post<import('@flyseri/types').FlightAncillaryPurchase>('/flights/bookings/' + encodeURIComponent(id) + '/extras/reconcile', undefined, {timeoutMs: 40000})).data; },
  async bookings(): Promise<FlightBooking[]> { return (await apiClient.get<FlightBooking[]>('/flights/bookings')).data; },
  async bookingForIntent(id: string): Promise<FlightBooking | null> { return (await apiClient.get<FlightBooking | null>('/flights/booking-intents/' + encodeURIComponent(id) + '/booking')).data; },
  async intentAncillaries(id: string): Promise<FlightAncillaryResponse> { return (await apiClient.post<FlightAncillaryResponse>('/flights/booking-intents/' + encodeURIComponent(id) + '/ancillaries', undefined, { timeoutMs: 40000 })).data; },
  async saveAncillarySelections(id: string, selections: import('@flyseri/types').FlightAncillarySelectionInput[]): Promise<FlightBookingIntent> {
    return (await apiClient.post<FlightBookingIntent>('/flights/booking-intents/' + encodeURIComponent(id) + '/ancillary-selections', { selections })).data;
  },
  async booking(id: string): Promise<FlightBooking> { return (await apiClient.get<FlightBooking>('/flights/bookings/' + encodeURIComponent(id))).data; },
  async refreshBooking(id: string): Promise<FlightBooking> { return (await apiClient.post<FlightBooking>('/flights/bookings/' + encodeURIComponent(id) + '/refresh', undefined, {timeoutMs: 20000})).data; },
  async refreshCheckout(id: string): Promise<FlightBooking> { return (await apiClient.post<FlightBooking>('/flights/bookings/' + encodeURIComponent(id) + '/refresh-checkout', undefined, {timeoutMs: 60000})).data; },
  async cancelBooking(id: string, confirmedPnr: string): Promise<FlightBooking> { return (await apiClient.post<FlightBooking>('/flights/bookings/' + encodeURIComponent(id) + '/cancel', {confirmedPnr}, {timeoutMs: 50000})).data; },
  async bookingCapabilities(): Promise<{reservationAvailable: boolean; ticketIssuanceAvailable: boolean; environment: string; message: string; ticketingMessage: string}> { return (await apiClient.get<{reservationAvailable: boolean; ticketIssuanceAvailable: boolean; environment: string; message: string; ticketingMessage: string}>('/flights/bookings/capabilities')).data; },
  async issueTickets(id: string, confirmedPnr: string): Promise<FlightBooking> { return (await apiClient.post<FlightBooking>('/flights/bookings/' + encodeURIComponent(id) + '/issue-tickets', {confirmedPnr}, {timeoutMs: 50000})).data; },
  async reserve(id: string, input: FlightReservationInput): Promise<FlightBooking> { return (await apiClient.post<FlightBooking>('/flights/booking-intents/' + encodeURIComponent(id) + '/reserve', input, {timeoutMs: 40000})).data; },
  async submitCheckoutAttempt(input: { searchId: string; offerId: string; idempotencyKey: string;
    contactName: string; contactEmail: string; contactPhone: string; passengerNames: string[] }): Promise<{ id: string; status: string; createdAt: string }> {
    return (await apiClient.post<{ id: string; status: string; createdAt: string }>('/flights/checkout-attempts', input)).data;
  },
  async search(input: FlightSearchRequest, options?: RequestOptions): Promise<FlightSearchResponse> {
    return (await apiClient.post<FlightSearchResponse>('/flights/search', input, { timeoutMs: 60000, ...options })).data;
  },
  async searchProgressively(input: FlightSearchRequest, onResults: (result: FlightSearchResponse) => void, options?: RequestOptions): Promise<FlightSearchResponse> {
    let final: FlightSearchResponse | undefined;
    let current:FlightSearchResponse|undefined;
    const headers=new Headers(options?.headers);headers.set('X-Flight-Stream-Format','delta-v1');
    const timing=flightSearchPerformance();
    try{await apiClient.postStream<FlightSearchEvent>('/flights/search/stream', input, (event) => {
      if (event.type === 'error') throw new ApiClientError(event.code, event.message, event.requestId);
      if(event.type==='delta'){
        const offers=new Map(current?.searchId===event.result.searchId?current.offers.map(offer=>[offer.offerId,offer]):[]);
        event.removedOfferIds.forEach(id=>offers.delete(id));
        event.result.offers.forEach(offer=>offers.set(offer.offerId,offer));
        current={...event.result,offers:[...offers.values()]};
        timing.arrived(current.offers.length);onResults(current);if(event.complete)final=current;
      }
      if (event.type === 'results') { current=event.result;timing.arrived(current.offers.length);onResults(current); if (event.complete) final = current; }
    }, { timeoutMs: 60000, ...options,headers });
    if (!final) throw new ApiClientError('NETWORK_ERROR', 'Flight search was interrupted.');
    return final;
    }finally{timing.finished(current?.offers.length??0,!!final);}
  },
  async createIntent(input: FlightBookingIntentInput): Promise<FlightBookingIntent> {
    return (await apiClient.post<FlightBookingIntent>('/flights/booking-intents', input)).data;
  },
  async intentsForTrip(tripId: string): Promise<FlightBookingIntent[]> {
    return (await apiClient.get<FlightBookingIntent[]>(`/flights/booking-intents?tripId=${encodeURIComponent(tripId)}`)).data;
  },
  async intent(id: string): Promise<FlightBookingIntent> {
    return (await apiClient.get<FlightBookingIntent>(`/flights/booking-intents/${encodeURIComponent(id)}`)).data;
  },
  async validateIntent(id: string): Promise<FlightBookingIntent> {
    return (await apiClient.post<FlightBookingIntent>(`/flights/booking-intents/${encodeURIComponent(id)}/validate`, undefined, { timeoutMs: 60000 })).data;
  },
  async confirmPrice(id: string): Promise<FlightBookingIntent> {
    return (await apiClient.post<FlightBookingIntent>(`/flights/booking-intents/${encodeURIComponent(id)}/confirm-price`, undefined)).data;
  },
  async cancelIntent(id: string): Promise<FlightBookingIntent> {
    return (await apiClient.delete<FlightBookingIntent>(`/flights/booking-intents/${encodeURIComponent(id)}`)).data;
  },
};
