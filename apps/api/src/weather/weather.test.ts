import 'reflect-metadata';
import { afterEach, expect, it, vi } from 'vitest';
import { currentForecast, WeatherService } from './weather.service.js';

const now = Date.parse('2026-10-12T03:30:00Z');
const payload = (temperature = 29.1) => ({ properties: { meta: { updated_at: new Date(now).toISOString() }, timeseries: [{ time: new Date(now).toISOString(), data: { instant: { details: { air_temperature: temperature } }, next_1_hours: { summary: { symbol_code: 'cloudy' } } } }] } });
afterEach(() => { vi.unstubAllGlobals(); vi.useRealTimers(); });
it('uses the nearest valid hourly forecast and rejects missing, invalid or stale values', () => {
  expect(currentForecast(payload(), now)).toMatchObject({ temperatureC: 29, condition: 'cloudy' });
  expect(currentForecast(payload(NaN), now)).toBeNull();
  expect(currentForecast(payload(), now + 2 * 60 * 60_000)).toBeNull();
  expect(currentForecast(undefined, now)).toBeNull();
});
it('coalesces concurrent requests, caches all destinations and conditionally revalidates', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const fetcher = vi.fn().mockImplementation(async () => new Response(JSON.stringify(payload()), { headers: { expires: new Date(now + 30 * 60_000).toUTCString(), 'last-modified': new Date(now).toUTCString() } }));
  vi.stubGlobal('fetch', fetcher); const service = new WeatherService();
  const [one, two] = await Promise.all([service.all(), service.all()]);
  expect(one).toEqual(two); expect(Object.keys(one)).toHaveLength(5); expect(fetcher).toHaveBeenCalledTimes(5);
  await service.all(); expect(fetcher).toHaveBeenCalledTimes(5);
  vi.setSystemTime(now + 31 * 60_000); fetcher.mockImplementation(async () => new Response(null, { status: 304 }));
  await service.all(); expect(fetcher).toHaveBeenCalledTimes(10);
  expect(fetcher.mock.calls[5]?.[1].headers['If-Modified-Since']).toBe(new Date(now).toUTCString());
});
it('backs off after failure and never provides fabricated fallback temperatures', async () => {
  vi.useFakeTimers(); vi.setSystemTime(now);
  const fetcher = vi.fn().mockResolvedValue(new Response(null, { status: 429 })); vi.stubGlobal('fetch', fetcher);
  const service = new WeatherService(); expect(await service.all()).toEqual({});
  expect(await service.all()).toEqual({}); expect(fetcher).toHaveBeenCalledTimes(5);
});
