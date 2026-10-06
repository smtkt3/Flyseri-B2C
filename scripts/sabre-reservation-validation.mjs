// Intentionally incomplete CERT request: no travelers, flights, offer, payment or booking reference.
// Schema validation only; cannot reserve an itinerary.
import { parseConfig } from '../packages/config/dist/index.js';
import { SabreOAuthV3Fetcher } from '../apps/api/dist/flight/sabre-oauth-v3.fetcher.js';
process.loadEnvFile('.env');
const config=parseConfig({...process.env,APP_ENV:'test'});
if(config.SABRE_ENV!=='CERT'||config.SABRE_BASE_URL!=='https://api.cert.platform.sabre.com') throw new Error('CERT only');
const {accessToken}=await new SabreOAuthV3Fetcher(config).fetchToken();
const agency=JSON.parse(config.SABRE_BOOKING_AGENCY);
if(process.argv.includes('--without-customer-number')) delete agency.agencyCustomerNumber;
const response=await fetch(`${config.SABRE_BASE_URL}/v1/trip/orders/createBooking`,{method:'POST',headers:{Authorization:`Bearer ${accessToken}`,'Content-Type':'application/json'},body:JSON.stringify({agency,travelers:[],flightDetails:{flights:[]}}),signal:AbortSignal.timeout(20000)});
console.log(JSON.stringify({status:response.status,body:await response.json()}));
