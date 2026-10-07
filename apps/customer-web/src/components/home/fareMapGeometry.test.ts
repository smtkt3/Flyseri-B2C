import { describe, expect, it } from 'vitest';
import { WORLD_VIEW, latitudeAtY, layoutMapLabels, mercatorY, projectAirport, transformMap } from './fareMapGeometry';

describe('flight map geography', () => {
  const viewport = { width: 1000, height: 500 };
  it('uses the same Mercator projection as map tiles and clamps the poles', () => {
    expect(projectAirport(0, 0, { lon: 0, lat: 0, zoom: 1 }, viewport)).toEqual({ x: 500, y: 250 });
    for (const lat of [-80, -33.95, 2.75, 51.47, 80]) expect(latitudeAtY(mercatorY(lat))).toBeCloseTo(lat, 7);
    expect(Number.isFinite(mercatorY(90))).toBe(true);
    expect(Number.isFinite(mercatorY(-90))).toBe(true);
  });
  it('moves geographic markers by the exact drag distance and preserves the point under zoom', () => {
    const airport = { lon: 55.37, lat: 25.25 };
    const before = projectAirport(airport.lon, airport.lat, WORLD_VIEW, viewport);
    const panned = transformMap(WORLD_VIEW, viewport, { x: 100, y: 100 }, { x: 240, y: 160 });
    const after = projectAirport(airport.lon, airport.lat, panned, viewport);
    expect(after.x - before.x).toBeCloseTo(140, 7);
    expect(after.y - before.y).toBeCloseTo(60, 7);
    const zoomed = transformMap(WORLD_VIEW, viewport, before, before, 4);
    expect(projectAirport(airport.lon, airport.lat, zoomed, viewport).x).toBeCloseTo(before.x, 7);
    expect(projectAirport(airport.lon, airport.lat, zoomed, viewport).y).toBeCloseTo(before.y, 7);
  });
  it('wraps across the date line and keeps zoom and latitude finite after extreme gestures', () => {
    const nearDateLine = projectAirport(-179, 0, { lon: 179, lat: 0, zoom: 1 }, viewport);
    expect(nearDateLine.x).toBeCloseTo(500 + 1000 * 2 / 360);
    const extreme = transformMap(WORLD_VIEW, viewport, { x: 0, y: 0 }, { x: 1e7, y: 1e7 }, 1000);
    expect(extreme.lon).toBeGreaterThanOrEqual(-180);
    expect(extreme.lon).toBeLessThan(180);
    expect(Math.abs(extreme.lat)).toBeLessThanOrEqual(85.052);
    expect(extreme.zoom).toBe(32);
  });
  it('keeps crowded destination labels separate while retaining exact airport anchors', () => {
    const point = { x: 210, y: 180 };
    const labels = layoutMapLabels(['BKK', 'SIN', 'DPS', 'CGK'].map(code => ({ code, point })), { width: 440, height: 400 }, true);
    expect(labels.length).toBeGreaterThan(1);
    for (const a of labels) {
      expect(a.anchor).toEqual(point);
      for (const b of labels.filter(label => label !== a)) expect(a.x + a.width <= b.x || b.x + b.width <= a.x || a.y + a.height <= b.y || b.y + b.height <= a.y).toBe(true);
    }
  });
});
