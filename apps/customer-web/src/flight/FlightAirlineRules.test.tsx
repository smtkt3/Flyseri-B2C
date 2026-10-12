// @vitest-environment jsdom
import { afterEach, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import type { FlightAncillaryRules } from '@flyseri/types';
import { FlightAirlineRules } from './FlightAirlineRules';
import { ancillarySelectionInputs, requestedExtra } from './flightAncillarySelections';

afterEach(cleanup);
const rules: FlightAncillaryRules = { source: 'SABRE_ATPCO', feeApplicationMethod: 'PER_5KG_OVER_FREE_BAGGAGE_ALLOWANCE', weightLimits: [{ value: 23, unit: 'KG', relation: 'UP_TO' }], quotedQuantity: 1, feeMayChange: true, refundabilityCode: null, serviceType: 'C', requiresWeightConfirmation: true };
it('explains 5kg pricing and does not label a service band as a purchasable maximum', () => {
  render(<FlightAirlineRules rules={rules} baggage/>);
  expect(screen.getByText('Per 5 kg above your included allowance')).toBeTruthy();
  expect(screen.getByText('Service weight band: up to 23 kg')).toBeTruthy();
  expect(screen.getByText(/not an allowance to buy/)).toBeTruthy();
  expect(screen.getByText(/maximum purchasable kilograms need airline confirmation/)).toBeTruthy();
});
it('keeps absent rules explicitly unknown', () => {
  render(<FlightAirlineRules baggage/>);
  expect(screen.getByText(/did not supply a fee basis/)).toBeTruthy();
  expect(screen.queryByText(/23/)).toBeNull();
});
it('preserves airline rules with selections and requires review if they change', () => {
  const service = { offerItemId: null, serviceCode: '0AA', name: 'BAG', groupCode: 'BG', amount: '150', currency: 'BDT', segmentLabels: ['DAC → CXB'], passengerIndexes: [0], rules };
  const extra = requestedExtra(service);
  expect(extra.rules).toEqual(rules);
  const quote = { quoteId: 'receipt', retrievedAt: '', bookingAvailable: false, services: [service] };
  expect(ancillarySelectionInputs([extra], quote)).toEqual([{ quoteId: 'receipt', serviceIndex: 0 }]);
  expect(() => ancillarySelectionInputs([extra], { ...quote, services: [{ ...service, rules: { ...rules, feeApplicationMethod: 'PER_1KG_OVER_FREE_BAGGAGE_ALLOWANCE' } }] })).toThrow(/rules.*changed/);
});
