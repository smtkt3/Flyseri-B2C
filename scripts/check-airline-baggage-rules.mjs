// Read-only CERT coverage check through the local Flyseri API. No booking,
// payment, passenger persistence or supplier mutation endpoints are called.
import { mkdir, writeFile } from 'node:fs/promises';
const results = [];
const base = 'http://localhost:3001/api/v1/flights';
async function post(path, body) {
  const response = await fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body), signal: AbortSignal.timeout(120000) });
  const data = await response.json();
  return { status: response.status, ...data };
}
for (const route of [
  { origin: 'DAC', destination: 'CXB', departureDate: '2026-10-24' },
  { origin: 'DAC', destination: 'BKK', departureDate: '2026-11-05' },
  { origin: 'KUL', destination: 'SIN', departureDate: '2026-11-05' },
]) {
  const search = await post('/search', { ...route, tripType: 'ONE_WAY', adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'BDT' });
  if (!search.success) { results.push({ ...route, stage: 'search', status: search.status, error: search.error }); continue; }
  const carriers = new Set();
  const offers = search.data.offers.filter(offer => {
    const carrier = offer.outbound.segments[0]?.marketingCarrier;
    if (!carrier || carriers.has(carrier) || offer.ndcContext || offer.outbound.stops > 0) return false;
    carriers.add(carrier); return true;
  }).slice(0, 2);
  for (const offer of offers) {
    const quote = await post('/ancillaries', { searchId: search.data.searchId, offerId: offer.offerId, passengers: [{ givenName: '', surname: '' }] });
    const baggage = quote.data?.services?.filter(service => service.groupCode === 'BG' || /baggage|luggage|per kg/i.test(service.name)) ?? [];
    results.push({ ...route, carrier: offer.outbound.segments[0].marketingCarrier,
      flight: offer.outbound.segments[0].flightNumber, status: quote.status,
      serviceCount: quote.data?.services?.length ?? null, baggageCount: baggage.length,
      baggage: baggage.map(({ name, serviceCode, amount, currency, rules }) => ({ name, serviceCode, amount, currency, rules })),
      ...(quote.success ? {} : { error: quote.error }) });
    console.log(JSON.stringify({ route: `${route.origin}-${route.destination}`, carrier: offer.outbound.segments[0].marketingCarrier, status: quote.status, baggageCount: baggage.length }));
  }
}
await mkdir('artifacts/baggage-rules', { recursive: true });
await writeFile('artifacts/baggage-rules/airline-coverage.json', JSON.stringify({ environment: 'Local API / Sabre CERT', checkedAt: new Date().toISOString(), results }, null, 2));
