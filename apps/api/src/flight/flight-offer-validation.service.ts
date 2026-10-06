import { Inject, Injectable } from '@nestjs/common';
import type { FlightBookingIntent, FlightOffer } from '@flyseri/types';
import { ApiException } from '../api-exception.js';
import { OFFER_VALIDATION_PROVIDER } from '../tokens.js';
import type { AppConfig } from '@flyseri/config';
import { SabreBookingManagementClient, selectCheckedAtpcoOffer } from './sabre-booking-management.client.js';
import { readPricedNdcOffer } from './sabre-ndc-price.js';

/** A normalized outcome. An account-specific adapter must map a documented Sabre response to this. */
export type FlightOfferValidationOutcome =
  | { result: 'AVAILABLE'; currentTotalAmount: string; currency: string; itinerary: Pick<FlightOffer, 'outbound' | 'inbound' | 'multiCityLegs'>; validatedAt: string; expiresAt?: string; ndcContext?: FlightOffer['ndcContext'] }
  | { result: 'UNAVAILABLE'; validatedAt: string }
  | { result: 'ITINERARY_CHANGED'; validatedAt: string };

export interface FlightOfferValidationProvider {
  validate(intent: FlightBookingIntent, requestId: string): Promise<FlightOfferValidationOutcome>;
}

/** Revalidation confirms the selected itinerary; FlightCheck provides the same
 * booking-class price used immediately before reservation, in PCC currency.
 */
export class BookingFlightValidationProvider implements FlightOfferValidationProvider {
  constructor(private readonly itineraryProvider: FlightOfferValidationProvider,
    private readonly booking: SabreBookingManagementClient, private readonly config: AppConfig) {}
  async validate(intent: FlightBookingIntent, requestId: string): Promise<FlightOfferValidationOutcome> {
    if (intent.selectedOffer.ndcContext) {
      try {
        const priced = readPricedNdcOffer(await this.booking.priceNdcOffer(intent.selectedOffer.ndcContext.offerItemIds ?? []), intent.selectedOffer);
        return { result: 'AVAILABLE', ...priced, itinerary: intent.selectedOffer, validatedAt: new Date().toISOString() };
      } catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'The airline could not confirm this NDC fare. Refresh flights or choose another fare.', 503); }
    }
    const itinerary = await this.itineraryProvider.validate(intent, requestId);
    if (itinerary.result !== 'AVAILABLE') return itinerary;
    if (!intent.searchRequest) throw new ApiException('CONFLICT', 'Booking validation requires the original search details.', 409);
    try {
      const passengerCodes = [...Array.from({ length: intent.searchRequest.adults }, () => 'ADT' as const), ...Array.from({ length: intent.searchRequest.children }, () => 'CNN' as const), ...Array.from({ length: intent.searchRequest.infants }, () => 'INF' as const)];
      const checked = selectCheckedAtpcoOffer(await this.booking.flightCheck(intent.selectedOffer, passengerCodes), intent.selectedOffer, this.config.SABRE_PCC!);
      return { ...itinerary, currentTotalAmount: checked.totalAmount, currency: checked.currency,
        validatedAt: new Date().toISOString(), expiresAt: checked.validUntil };
    } catch { throw new ApiException('DEPENDENCY_UNAVAILABLE', 'The reservation fare could not be confirmed. Please try again.', 503); }
  }
}

@Injectable()
export class FlightOfferValidationService {
  constructor(@Inject(OFFER_VALIDATION_PROVIDER) private readonly provider: FlightOfferValidationProvider | undefined) {}

  async validate(intent: FlightBookingIntent, requestId: string): Promise<FlightOfferValidationOutcome> {
    if (!this.provider) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'The latest flight fare cannot be confirmed yet. Please try again later.', 503);
    return this.provider.validate(intent, requestId);
  }
}
