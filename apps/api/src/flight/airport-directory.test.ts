import { readFile } from 'node:fs/promises';
import { expect, it } from 'vitest';
import { AirportDirectoryService } from './airport-directory.service.js';

it.each([
  ["Cox’s Bazar", 'CXB'], ['coxsbazar', null], ['Málaga', 'AGP'],
  ['Malaga', 'AGP'], ['Dhaka', 'DAC'], ['Bangkok', null],
  ['London', null], ['Singapore', 'SIN'], ['kul', 'KUL'], ['Unknown destination', null],
])('resolves a known airport or asks for confirmation: %s', async (name, expected) => {
  expect(await new AirportDirectoryService().resolve(name)).toBe(expected);
});

it('serves readable destination names in suggestions and itinerary details', async () => {
  const service = new AirportDirectoryService();
  const [cox] = await service.suggestions('CXB');
  expect(cox?.cityLabel).toBe("Cox's Bazar");
  expect(cox?.cityCenterName).toBe("Cox's Bazar");
  expect((await service.suggestions("Cox's Bazar")).some(airport => airport.code === 'CXB')).toBe(true);
  const details = await service.details(['CXB', 'ADB', 'AGP', 'GRU']);
  expect(details.CXB?.city).toBe("Cox's Bazar");
  expect(details.ADB?.city).toBe('İzmir');
  expect(details.AGP?.city).toBe('Málaga');
  expect(details.GRU?.city).toBe('São Paulo');
});

it('keeps the frontend and API airport directories identical and free of corrupted character sequences', async () => {
  const source = await readFile(new URL('../../../customer-web/src/flight/data/airports.json', import.meta.url), 'utf8');
  const api = await readFile(new URL('../../assets/airports.json', import.meta.url), 'utf8');
  expect(api).toBe(source);
  const airports = JSON.parse(source) as Record<string, unknown>[];
  for (const airport of airports) {
    for (const value of Object.values(airport)) {
      if (typeof value === 'string') {
        expect(value, `Invalid text for ${airport.code}`).not.toMatch(/[\u0080-\u009f\ufffd]|â[€™œ“”–—]|Ã[\u0080-\u00bf…]/u);
      }
    }
  }
});
