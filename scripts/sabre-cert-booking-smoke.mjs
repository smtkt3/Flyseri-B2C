/** Controlled Sabre CERT test. Requires a built workspace and existing server .env.
 *  Default mode is read-only. --create makes exactly one CreateBooking attempt per machine.
 *  Never use this script with production credentials or customer passenger details.
 */
import { open, readFile, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { parseConfig } from '../packages/config/dist/index.js';
import { SabreOAuthV3Fetcher } from '../apps/api/dist/flight/sabre-oauth-v3.fetcher.js';
import { SabreBfmClient } from '../apps/api/dist/flight/sabre-bfm.client.js';
import { buildSabreBfmV5Request, mapSabreV5Offers } from '../apps/api/dist/flight/sabre-v5.contract.js';
import { SabreBookingManagementClient, buildSabreCreateBooking, selectCheckedAtpcoOffer,
  SabreBookingUnknownError } from '../apps/api/dist/flight/sabre-booking-management.client.js';

process.loadEnvFile('.env');
const config = parseConfig({ ...process.env, APP_ENV: 'test' });
if (config.SABRE_ENV !== 'CERT' || config.SABRE_BASE_URL !== 'https://api.cert.platform.sabre.com' ||
  config.SABRE_AUTH_URL !== 'https://api.cert.platform.sabre.com/v3/auth/token') throw new Error('CERT configuration required');

const create = process.argv.includes('--create');
const marker = join(tmpdir(), 'flyseri-sabre-cert-booking-attempt-2026-09-30.json');
const search = { origin: 'KUL', destination: 'PEN', departureDate: '2026-12-10', tripType: 'ONE_WAY',
  adults: 1, children: 0, infants: 0, cabin: 'ECONOMY', currency: 'MYR' };
const tokenFetcher = new SabreOAuthV3Fetcher(config);
let cachedToken;
const auth = { token: async () => cachedToken ??= (await tokenFetcher.fetchToken()).accessToken,
  invalidate: async () => { cachedToken = undefined; } };
const bfm = new SabreBfmClient(config, auth, {
  buildRequest: (input, mode) => buildSabreBfmV5Request(input, config, mode),
  mapResponse: (response, input) => mapSabreV5Offers(response, 1000, input?.tripType === 'MULTI_CITY'),
});
const booking = new SabreBookingManagementClient(config, auth);
const { offers } = await bfm.search(search, 'cert-controlled-booking-smoke');
const selected = offers.find((offer) => offer.outbound.stops === 0 && offer.outbound.segments.length === 1 &&
  offer.outbound.segments[0].marketingCarrier === 'MH' && offer.outbound.segments[0].flightNumber === '1194' &&
  offer.outbound.segments[0].bookingClass === 'Q' && offer.totalAmount === '305.76' && offer.currency === 'MYR' &&
  (!offer.outbound.segments[0].operatingCarrier || offer.outbound.segments[0].operatingCarrier === 'MH'));
if (!selected) throw new Error('The reviewed MH1194 Q CERT shopping fare is no longer available');
const checked = selectCheckedAtpcoOffer(await booking.flightCheck(selected, 1), selected, config.SABRE_PCC);
if (create && (checked.currency !== 'BDT' || checked.totalAmount !== '9270')) {
  throw new Error('The reviewed CERT FlightCheck fare changed; no booking was sent');
}
const summary = { environment: 'CERT', route: 'KUL-PEN', date: search.departureDate,
  flights: selected.outbound.segments.map((segment) => `${segment.marketingCarrier}${segment.flightNumber} ${segment.bookingClass}`),
  shopping: `${selected.currency} ${selected.totalAmount}`, checked: `${checked.currency} ${checked.totalAmount}`,
  checkedFareExpiresAt: checked.validUntil };
if (!create) {
  process.stdout.write(JSON.stringify({ ...summary, bookingAttempted: false }) + '\n');
  process.exit(0);
}

// The supplied Postman 2026.08 ATPCO 1xADT example uses these illustrative CERT fields.
// They are never read from the customer UI and are not Flyseri's production agency settings.
const agency = { address: { name: 'John Smith', street: '1230 Ellen Ave, apt 10', city: 'Dallas',
  stateProvince: 'TX', postalCode: '75063', countryCode: 'US',
  freeText: 'John Smith\n1230 Ellen Ave, apt 10\nDallas, TX 75063\nUS' },
  agencyCustomerNumber: '1234567', ticketingPolicy: 'TODAY' };
const billingAddress = { name: 'John Smith', street: '1230 Ellen Ave, apt 10', city: 'Dallas',
  stateProvince: 'TX', postalCode: '75063', countryCode: 'US' };
const body = buildSabreCreateBooking(selected,
  [{ givenName: 'John', surname: 'Smith', birthDate: '1970-01-23', passengerCode: 'ADT' }],
  { email: 'travel@sabre.com', phone: '+123456' }, agency, billingAddress);

let handle;
try { handle = await open(marker, 'wx', 0o600); }
catch {
  const prior = JSON.parse(await readFile(marker, 'utf8'));
  process.stdout.write(JSON.stringify({ bookingAttempted: false, blockedByPriorAttempt: true, priorStatus: prior.status }) + '\n');
  process.exit(1);
}
await handle.writeFile(JSON.stringify({ status: 'IN_PROGRESS', startedAt: new Date().toISOString(), ...summary }));
await handle.close();
try {
  const reservation = await booking.createBooking(body);
  await writeFile(marker, JSON.stringify({ status: 'PNR_CREATED', createdAt: new Date().toISOString(), ...summary,
    pnr: reservation.confirmationId, sabreBookingId: reservation.sabreBookingId }));
  let getBookingVerified = false;
  try {
    const refreshed = await booking.getBooking(reservation.confirmationId);
    getBookingVerified = refreshed.bookingId === reservation.sabreBookingId;
  } catch { /* The PNR remains recorded; only a read-only GetBooking may be retried. */ }
  process.stdout.write(JSON.stringify({ ...summary, bookingAttempted: true, pnrCreated: true, getBookingVerified }) + '\n');
} catch (error) {
  const status = error instanceof SabreBookingUnknownError ? 'BOOKING_UNKNOWN' : 'BOOKING_REJECTED';
  await writeFile(marker, JSON.stringify({ status, ...summary, checkedFare: checked,
    reason: error instanceof SabreBookingUnknownError ? error.reason : 'REJECTED',
    httpStatus: error instanceof SabreBookingUnknownError ? error.httpStatus ?? null : null,
    failedAt: new Date().toISOString() }));
  process.stdout.write(JSON.stringify({ ...summary, bookingAttempted: true, status,
    reason: error instanceof SabreBookingUnknownError ? error.reason : 'REJECTED',
    httpStatus: error instanceof SabreBookingUnknownError ? error.httpStatus ?? null : null }) + '\n');
  process.exitCode = 1;
}
