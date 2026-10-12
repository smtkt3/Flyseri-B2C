import { Injectable } from '@nestjs/common';

const destinations = { BKK: [13.7563, 100.5018], KUL: [3.139, 101.6869], DPS: [-8.65, 115.2167], DXB: [25.2048, 55.2708], SIN: [1.3521, 103.8198] } as const;
type Forecast = { properties?: { meta?: { updated_at?: string }; timeseries?: { time: string; data?: { instant?: { details?: { air_temperature?: number } }; next_1_hours?: { summary?: { symbol_code?: string } } } }[] } };
type Cache = { payload?: Forecast; expires: number; modified?: string; pending?: Promise<void> };
export type DestinationWeather = { temperatureC: number; condition: string; forecastAt: string; updatedAt: string };

export function currentForecast(payload: Forecast | undefined, now = Date.now()): DestinationWeather | null {
  const series = payload?.properties?.timeseries;
  const point = (Array.isArray(series) ? series : []).filter(item => item && Math.abs(Date.parse(item.time) - now) < 90 * 60_000)
    .sort((a, b) => Math.abs(Date.parse(a.time) - now) - Math.abs(Date.parse(b.time) - now))[0];
  const temperature = point?.data?.instant?.details?.air_temperature;
  const updatedAt = payload?.properties?.meta?.updated_at;
  if (!point || typeof temperature !== 'number' || !Number.isFinite(temperature) || temperature < -90 || temperature > 65 || !updatedAt || !Number.isFinite(Date.parse(updatedAt))) return null;
  return { temperatureC: Math.round(temperature), condition: point.data?.next_1_hours?.summary?.symbol_code ?? 'unknown', forecastAt: point.time, updatedAt };
}

@Injectable()
export class WeatherService {
  private readonly cache = new Map<string, Cache>();
  private async destination(code: keyof typeof destinations): Promise<DestinationWeather | null> {
    let entry = this.cache.get(code);
    if (!entry) { entry = { expires: 0 }; this.cache.set(code, entry); }
    const cache = entry;
    if (!cache.pending && cache.expires <= Date.now()) {
      cache.pending = (async () => {
        try {
          const [lat, lon] = destinations[code];
          const headers: Record<string, string> = { 'User-Agent': 'Flyseri/1.0 https://flyseri-b2c-murex.vercel.app/help' };
          if (cache.modified) headers['If-Modified-Since'] = cache.modified;
          const response = await fetch(`https://api.met.no/weatherapi/locationforecast/2.0/compact?lat=${lat}&lon=${lon}`, { headers, signal: AbortSignal.timeout(7000) });
          if (!response.ok && response.status !== 304) throw new Error('Weather unavailable');
          if (response.status !== 304) {
            cache.payload = await response.json() as Forecast;
            cache.modified = response.headers.get('last-modified') ?? undefined;
          }
          const expires = Date.parse(response.headers.get('expires') ?? '');
          cache.expires = Math.max(Date.now() + 10 * 60_000, Number.isFinite(expires) ? expires : 0);
        } catch {
          // Back off on provider failures; never substitute illustrative temperatures.
          cache.payload = undefined;
          cache.modified = undefined;
          cache.expires = Date.now() + 5 * 60_000;
        } finally { cache.pending = undefined; }
      })();
    }
    await cache.pending;
    return currentForecast(cache.payload);
  }
  async all(): Promise<Record<string, DestinationWeather>> {
    const entries = await Promise.all((Object.keys(destinations) as (keyof typeof destinations)[]).map(async code => [code, await this.destination(code)] as const));
    return Object.fromEntries(entries.filter((entry): entry is readonly [keyof typeof destinations, DestinationWeather] => entry[1] !== null));
  }
}
