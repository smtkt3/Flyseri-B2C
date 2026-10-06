// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FlightOffer, FlightSearchRequest } from '@flyseri/types';
import { FlightPriceDetails } from './FlightPriceDetails';
import { flightPriceSummary, type PurchasedFlightExtra } from './flightPriceSummary';
import { emptyServicePreferences } from './FlightServiceRequests';

afterEach(cleanup);
const search: FlightSearchRequest = { origin: 'KUL', destination: 'SIN', departureDate: '2026-11-18', tripType: 'ONE_WAY', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'MYR' };
const offer: FlightOffer = { offerId: 'test', totalAmount: '234.00', currency: 'MYR', airlineCodes: ['TR'], baggageSummary: null, outbound: { segments: [], stops: 0, durationMinutes: 60 }, inbound: null,
  priceBreakdown: { baseFareAmount: '180.00', taxesAndFeesAmount: '54.00', currency: 'MYR' } };

describe('checkout airfare breakdown', () => {
  it('shows the actual aggregate base fare and taxes without dividing or multiplying the quote', () => {
    render(<FlightPriceDetails offer={offer} search={{ ...search, adults: 2 }} />);
    expect(screen.getByText('(2 adults)')).toBeTruthy();
    expect(screen.getByText('Fare').nextElementSibling?.textContent).toMatch(/180\.00/);
    expect(screen.getByText('Taxes & fees').nextElementSibling?.textContent).toMatch(/54\.00/);
    expect(screen.getByText('Total').nextElementSibling?.textContent).toMatch(/234\.00/);
    expect(screen.queryByText(/Meals/)).toBeNull();
  });
  it('omits an unavailable or mismatched split while preserving the true total', () => {
    const view = render(<FlightPriceDetails offer={{ ...offer, priceBreakdown: undefined }} search={search} />);
    expect(screen.queryByText('Fare')).toBeNull();
    expect(screen.getByText('Airfare').nextElementSibling?.textContent).toMatch(/234\.00/);
    view.rerender(<FlightPriceDetails offer={{ ...offer, priceBreakdown: { ...offer.priceBreakdown!, currency: 'USD' } }} search={search} />);
    expect(screen.queryByText('Taxes & fees')).toBeNull();
  });
  it('updates all amounts to the refreshed fare and displays a genuine zero tax amount', () => {
    const view = render(<FlightPriceDetails offer={offer} search={search} />);
    view.rerender(<FlightPriceDetails offer={{ ...offer, totalAmount: '136.00', priceBreakdown: { baseFareAmount: '136.00', taxesAndFeesAmount: '0.00', currency: 'MYR' } }} search={search} />);
    expect(screen.queryByText(/234\.00/)).toBeNull();
    expect(screen.getByText('Taxes & fees').nextElementSibling?.textContent).toMatch(/0\.00/);
    expect(screen.getByText('Total').nextElementSibling?.textContent).toMatch(/136\.00/);
  });
  it('itemizes purchased baggage and meals and adds their quantities to the total exactly once', () => {
    const extras: PurchasedFlightExtra[] = [
      { id: 'bag', category: 'BAGGAGE', description: 'Extra checked baggage · 5 kg', passengerIndexes: [0], quantity: 2, unitAmount: '50.00', currency: 'MYR', status: 'PURCHASED' },
      { id: 'meal', category: 'MEAL', description: 'Chicken meal', passengerIndexes: [0], quantity: 1, unitAmount: '25.00', currency: 'MYR', status: 'PURCHASED' },
    ];
    render(<FlightPriceDetails offer={{ ...offer, baggageAllowances: [{ type: 'CARRY_ON', availability: 'INCLUDED', description: '7 kg', segmentIndexes: [] }] }} search={search} purchasedExtras={extras} />);
    expect(screen.getByText('Free')).toBeTruthy();
    expect(screen.getByText('Chicken meal')).toBeTruthy();
    expect(screen.getByText('Total').nextElementSibling?.textContent).toMatch(/359\.00/);
    expect(flightPriceSummary(offer, search, [...extras, extras[0]!]).totalAmount).toBeNull();
    expect(flightPriceSummary(offer, search, [{ ...extras[0]!, currency: 'USD' }]).totalAmount).toBeNull();
  });
  it('keeps service requests and unpurchased quotes outside the payable total', () => {
    render(<FlightPriceDetails offer={offer} search={search} requests={[{ ...emptyServicePreferences(), meal: 'VEGETARIAN', baggage: 'EXTRA_CHECKED' }]} />);
    expect(screen.getAllByText('Requested')).toHaveLength(2);
    expect(screen.getByText('Total').nextElementSibling?.textContent).toMatch(/234\.00/);
    const quote = { id: 'quote', category: 'MEAL', description: 'Quoted meal', passengerIndexes: [0], quantity: 1, unitAmount: '25.00', currency: 'MYR', status: 'QUOTED' } as unknown as PurchasedFlightExtra;
    expect(flightPriceSummary(offer, search, [quote]).totalAmount).toBe('234.00');
  });
});
