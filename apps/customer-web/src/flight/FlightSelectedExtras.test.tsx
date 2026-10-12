// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FlightAncillaryRequest } from '@flyseri/types';
import { FlightSelectedExtras } from './FlightSelectedExtras';

vi.mock('../components/LocaleMenu', () => ({ preferredCurrency: () => 'MYR', currencyPreferenceEvent: 'test-currency-change' }));
vi.mock('../services/flightService', () => ({ flightService: { ancillaryDisplayPrices: vi.fn() } }));
afterEach(cleanup);

it('supports adding the first extra, changing its price and removing the last extra without crashing', () => {
  const onEstimatedTripTotal = vi.fn();
  const airfare = { amount: '200.00', currency: 'MYR' };
  const extra: FlightAncillaryRequest = { id: 'bag', name: 'Extra baggage', serviceCode: 'BAG', category: 'BAGGAGE', segmentLabels: ['KUL → PEN'], passengerIndexes: [0], amount: '50.00', currency: 'MYR', status: 'REQUESTED' };
  const view = render(<FlightSelectedExtras requests={[]} airfare={airfare} onEstimatedTripTotal={onEstimatedTripTotal} />);
  expect(onEstimatedTripTotal).toHaveBeenLastCalledWith(null);

  view.rerender(<FlightSelectedExtras requests={[extra]} airfare={airfare} onEstimatedTripTotal={onEstimatedTripTotal} />);
  expect(screen.getByText('Extra baggage')).toBeTruthy();
  expect(onEstimatedTripTotal).toHaveBeenLastCalledWith({ amount: 250, currency: 'MYR' });

  view.rerender(<FlightSelectedExtras requests={[{ ...extra, amount: '0.00' }]} airfare={airfare} onEstimatedTripTotal={onEstimatedTripTotal} />);
  expect(onEstimatedTripTotal).toHaveBeenLastCalledWith({ amount: 200, currency: 'MYR' });

  view.rerender(<FlightSelectedExtras requests={[]} airfare={airfare} onEstimatedTripTotal={onEstimatedTripTotal} />);
  expect(screen.queryByText('Extra baggage')).toBeNull();
  expect(onEstimatedTripTotal).toHaveBeenLastCalledWith(null);
});

it('does not add a weight rate to the payable or estimated trip total', () => {
  const onEstimatedTripTotal = vi.fn();
  const extra: FlightAncillaryRequest = { id: 'bag', name: 'PER KG BAGGAGE', serviceCode: 'BAG', category: 'BAGGAGE', segmentLabels: ['DAC → CXB'], passengerIndexes: [0], amount: '150.00', currency: 'MYR', status: 'REQUESTED', rules: { source: 'SABRE_ATPCO', feeApplicationMethod: 'PER_1KG_OVER_FREE_BAGGAGE_ALLOWANCE', weightLimits: [], quotedQuantity: 1, feeMayChange: null, refundabilityCode: null, serviceType: 'C', requiresWeightConfirmation: true } };
  render(<FlightSelectedExtras requests={[extra]} airfare={{ amount: '200.00', currency: 'MYR' }} onEstimatedTripTotal={onEstimatedTripTotal}/>);
  expect(screen.getByText('Awaiting weight quote')).toBeTruthy();
  expect(screen.queryByText('Estimated trip with extras')).toBeNull();
  expect(onEstimatedTripTotal).toHaveBeenLastCalledWith(null);
});
