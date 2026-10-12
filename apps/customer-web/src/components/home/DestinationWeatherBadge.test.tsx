// @vitest-environment jsdom
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, expect, it, vi } from 'vitest';
vi.mock('../../lib/api/client', () => ({ apiClient: { get: vi.fn() } }));
import { apiClient } from '../../lib/api/client';
import { DestinationWeatherBadge, useDestinationWeather } from './DestinationWeatherBadge';

afterEach(() => { cleanup(); vi.restoreAllMocks(); });
const weather = () => ({ temperatureC: 29, condition: 'cloudy', forecastAt: new Date().toISOString(), updatedAt: new Date().toISOString() });
it('shows the fetched temperature with forecast time and provider credit in the tooltip', () => {
  render(<DestinationWeatherBadge weather={weather()} city="Bangkok" />);
  expect(screen.getByText('29°C')).toBeTruthy();
  expect(screen.getByLabelText(/Bangkok: 29 degrees Celsius/).title).toContain('MET Norway hourly forecast');
  expect(screen.queryByText('Sample')).toBeNull();
});
it('hides absent and stale weather rather than displaying a demo or outdated temperature', () => {
  const view = render(<DestinationWeatherBadge city="Bangkok" />); expect(view.container.textContent).toBe('');
  view.rerender(<DestinationWeatherBadge city="Bangkok" weather={{...weather(),forecastAt:'2020-01-01T00:00:00Z'}} />);
  expect(view.container.textContent).toBe('');
});
it('loads all destinations anonymously without blocking the card on provider failure', async () => {
  vi.mocked(apiClient.get).mockRejectedValueOnce(new Error('offline'));
  function Preview() { const data = useDestinationWeather(); return <DestinationWeatherBadge weather={data.BKK} city="Bangkok" />; }
  const view = render(<Preview />);
  await act(async () => {});
  expect(view.container.textContent).toBe('');
  expect(apiClient.get).toHaveBeenCalledWith('/weather/destinations', expect.objectContaining({anonymous:true}));
});
