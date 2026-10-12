import { useEffect, useState } from 'react';
import { apiClient } from '../../lib/api/client';

type Weather = { temperatureC: number; condition: string; forecastAt: string; updatedAt: string };
type WeatherMap = Record<string, Weather>;

/** Fetch once for the carousel, refresh while visible, and never use demo temperatures. */
export function useDestinationWeather() {
  const [weather, setWeather] = useState<WeatherMap>({});
  useEffect(() => {
    let active = true;
    let request: AbortController | undefined;
    const refresh = async () => {
      if (document.hidden || request) return;
      const controller = new AbortController(); request = controller;
      try {
        const result = await apiClient.get<WeatherMap>('/weather/destinations', { anonymous: true, timeoutMs: 10_000, signal: controller.signal });
        if (active) setWeather(result.data && typeof result.data === 'object' ? result.data : {});
      } catch { if (active) setWeather({}); }
      finally { request = undefined; }
    };
    void refresh();
    const timer = setInterval(() => { void refresh(); }, 10 * 60_000);
    const visible = () => { if (!document.hidden) void refresh(); };
    document.addEventListener('visibilitychange', visible);
    return () => { active = false; clearInterval(timer); request?.abort(); document.removeEventListener('visibilitychange', visible); };
  }, []);
  return weather;
}

export function DestinationWeatherBadge({ weather, city }: { weather?: Weather; city: string }) {
  if (!weather || !Number.isFinite(weather.temperatureC) || !Number.isFinite(Date.parse(weather.forecastAt)) || Math.abs(Date.parse(weather.forecastAt) - Date.now()) >= 90 * 60_000) return null;
  const wet = /rain|sleet|snow/.test(weather.condition), cloudy = /cloud|fog/.test(weather.condition);
  const condition = weather.condition.replace(/_(day|night|polartwilight)$/, '').replace(/_/g, ' ');
  return <span className="journey-weather-badge" aria-label={`${city}: ${weather.temperatureC} degrees Celsius, ${condition}, hourly forecast`} title={`MET Norway hourly forecast · ${condition} · ${new Date(weather.forecastAt).toLocaleString()} · Updated ${new Date(weather.updatedAt).toLocaleString()}`}>
    <span><svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7">{wet || cloudy ? <><path d="M7 17a5 5 0 1 1 1-9 6 6 0 0 1 11 3 3 3 0 0 1 0 6H7Z"/>{wet && <path d="m8 20-1 2m6-2-1 2m6-2-1 2"/>}</> : <><circle cx="12" cy="12" r="4"/><path d="M12 2v2m0 16v2M2 12h2m16 0h2M5 5l1.5 1.5m11 11L19 19M5 19l1.5-1.5m11-11L19 5"/></>}</svg>{weather.temperatureC}°C</span>
  </span>;
}
