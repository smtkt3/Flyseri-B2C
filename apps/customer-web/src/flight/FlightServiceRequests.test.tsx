// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { emptyServicePreferences, FlightServiceRequestFields, hasServiceRequest, serviceRequestSummary } from './FlightServiceRequests';
afterEach(cleanup);
it('captures each service request and an optional note for the selected traveller', () => {
  const onChange = vi.fn();
  render(<FlightServiceRequestFields value={emptyServicePreferences()} onChange={onChange} disabled={false} label="Traveller 1" />);
  for (const [label, option] of [['Meal preference', 'Halal meal'], ['Baggage request', 'Request extra checked baggage'], ['Wheelchair assistance', 'Assistance with distances and stairs'], ['Other assistance', 'Vision assistance']]) {
    fireEvent.click(screen.getByRole('button', { name: label }));
    fireEvent.click(screen.getByRole('option', { name: option }));
  }
  fireEvent.change(screen.getByLabelText(/Additional request/), { target: { value: 'Confirm extra baggage.' } });
  expect(onChange.mock.calls.map(call => call[0])).toEqual([{ meal: 'HALAL' }, { baggage: 'EXTRA_CHECKED' }, { wheelchair: 'STAIRS' }, { assistance: 'VISION' }, { note: 'Confirm extra baggage.' }]);
  expect(hasServiceRequest(emptyServicePreferences())).toBe(false);
  const preferences = { ...emptyServicePreferences(), meal: 'HALAL' as const, wheelchair: 'STAIRS' as const };
  expect(hasServiceRequest(preferences)).toBe(true);
  expect(serviceRequestSummary(preferences)).toBe('Halal meal · Assistance with distances and stairs');
});
