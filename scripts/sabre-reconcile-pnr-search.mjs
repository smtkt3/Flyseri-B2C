// Read-only, exact passenger-name search within the configured CERT PCC.
import {createRequire} from 'node:module';
import {DatabaseConnection} from '../packages/database/dist/index.js';
import {parseConfig} from '../packages/config/dist/index.js';
const require=createRequire(new URL('../apps/api/package.json',import.meta.url));
const {XMLParser}=require('fast-xml-parser');
process.loadEnvFile('.env');
const config=parseConfig({...process.env,APP_ENV:'test'});
if(config.SABRE_ENV!=='CERT'||config.SABRE_BASE_URL!=='https://api.cert.platform.sabre.com') throw new Error('CERT only');
const db=new DatabaseConnection(config.DATABASE_URL);
try {
 const {rows}=await db.pool.query(`SELECT t.legal_first_name,t.legal_middle_name,t.legal_last_name FROM flight_bookings b JOIN flight_booking_intent_travellers it ON it.booking_intent_id=b.booking_intent_id JOIN travellers t ON t.id=it.traveller_id WHERE b.id=$1 AND b.status='BOOKING_UNKNOWN'`,['6e9de704-68b2-4540-b658-3c3db51c718f']);
 if(rows.length!==1)throw new Error('Expected one passenger on the uncertain attempt');
 const esc=value=>String(value).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;').replaceAll("'",'&apos;');
 const first=[rows[0].legal_first_name,rows[0].legal_middle_name].filter(Boolean).join(' ');
 const parser=new XMLParser({removeNSPrefix:true,ignoreAttributes:false});
 const security=`<Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext"><UsernameToken><Username>${esc(config.SABRE_USERNAME.split('-')[0])}</Username><Password>${esc(config.SABRE_PASSWORD)}</Password><Organization>${esc(config.SABRE_PCC)}</Organization><Domain>DEFAULT</Domain><ClientId>${esc(config.SABRE_CLIENT_ID)}</ClientId><ClientSecret>${esc(config.SABRE_CLIENT_SECRET)}</ClientSecret></UsernameToken></Security>`;
 const authentication=`<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header><MessageHeader xmlns="http://www.ebxml.org/namespaces/messageHeader"><From><PartyId>Agency</PartyId></From><To><PartyId>Sabre_API</PartyId></To><ConversationId>Flyseri.CERT.ReadOnly.Reconciliation</ConversationId><Action>SessionCreateRQ</Action></MessageHeader>${security}</SOAP-ENV:Header><SOAP-ENV:Body><SessionCreateRQ returnContextID="true" Version="2.0.0" xmlns="http://www.opentravel.org/OTA/2002/11"/></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
 const authenticationResponse=await fetch('https://webservices.cert.platform.sabre.com',{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:'SessionCreateRQ'},body:authentication,signal:AbortSignal.timeout(20000),redirect:'error'});
 const authenticationResult=parser.parse(await authenticationResponse.text());
 const tokenValue=authenticationResult?.Envelope?.Header?.Security?.BinarySecurityToken;
 const accessToken=typeof tokenValue==='string'?tokenValue:tokenValue?.['#text'];
 if(typeof accessToken!=='string'||!accessToken){const fault=authenticationResult?.Envelope?.Body?.Fault;console.log(JSON.stringify({stage:'SOAP_AUTHENTICATION',httpStatus:authenticationResponse.status,faultCode:fault?.faultcode,fault:fault?.faultstring,searchSent:false}));throw new Error('SOAP lookup authentication failed');}
 const body=`<SOAP-ENV:Envelope xmlns:SOAP-ENV="http://schemas.xmlsoap.org/soap/envelope/"><SOAP-ENV:Header><MessageHeader xmlns="http://www.ebxml.org/namespaces/messageHeader"><From><PartyId>Agency</PartyId></From><To><PartyId>SWS</PartyId></To><ConversationId>Flyseri.CERT.ReadOnly.Reconciliation</ConversationId><Action>Trip_SearchRQ</Action></MessageHeader><Security xmlns="http://schemas.xmlsoap.org/ws/2002/12/secext"><BinarySecurityToken EncodingType="Base64Binary" valueType="String">${esc(accessToken)}</BinarySecurityToken></Security></SOAP-ENV:Header><SOAP-ENV:Body><Trip_SearchRQ Version="4.5.0" xmlns="http://webservices.sabre.com/triprecord"><ReadRequests><ReservationReadRequest><NameCriteria><Name><FirstName MatchMode="EXACT">${esc(first)}</FirstName><LastName MatchMode="EXACT">${esc(rows[0].legal_last_name)}</LastName></Name></NameCriteria><PosCriteria AnyBranch="false"><Pcc>${esc(config.SABRE_PCC)}</Pcc></PosCriteria><ReturnOptions ResponseFormat="STL" ViewName="TripSearch" SearchType="ACTIVE" MaxItemsReturned="20"/></ReservationReadRequest></ReadRequests></Trip_SearchRQ></SOAP-ENV:Body></SOAP-ENV:Envelope>`;
 try {
 const response=await fetch('https://webservices.cert.platform.sabre.com',{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:'Trip_SearchRQ'},body,signal:AbortSignal.timeout(20000),redirect:'error'});
 const parsed=parser.parse(await response.text());
 const payload=parsed?.Envelope?.Body;
 const locators=[];
 const shape=[];
 const collect=(value,path='')=>{if(Array.isArray(value))value.forEach((entry,index)=>collect(entry,`${path}[${index}]`));else if(value&&typeof value==='object'){for(const [key,entry] of Object.entries(value)){if(/locator|pnr/i.test(key)){const id=typeof entry==='string'?entry:entry?.['@_Id'];if(typeof id==='string'&&/^[A-Z0-9]{6}$/.test(id))locators.push(id);}collect(entry,`${path}.${key}`);}}else if(shape.length<60)shape.push({path,type:typeof value,...(/Status|Count|Found|NumberOf|Code$/.test(path)&&typeof value!=='object'?{value}: {})});};collect(payload);
 const errors=JSON.stringify(payload?.Trip_SearchRS?.ApplicationResults??{}).replaceAll(first,'[redacted]').replaceAll(rows[0].legal_last_name,'[redacted]').slice(0,1200);
 const count=payload?.Trip_SearchRS?.ReservationsList?.['@_TotalResults'];
 const resultCount=typeof count==='string'&&/^\d+$/.test(count)?Number(count):undefined;
 console.log(JSON.stringify({httpStatus:response.status,responseKeys:Object.keys(payload??{}),faultCode:payload?.Fault?.faultcode,fault:payload?.Fault?.faultstring,resultCount,possibleLocators:[...new Set(locators)],shape,applicationResults:errors}));
 if(response.ok && Object.hasOwn(payload?.Trip_SearchRS??{},'Success') && resultCount===0) {
   const checkedAt=new Date().toISOString();
   await db.pool.query(`INSERT INTO audit_events (actor_customer_id,trip_id,event) SELECT customer_id,trip_id,$2 FROM flight_bookings WHERE id=$1 AND status='BOOKING_UNKNOWN'`,['6e9de704-68b2-4540-b658-3c3db51c718f',`flight.booking.reconciliation:6e9de704-68b2-4540-b658-3c3db51c718f:${JSON.stringify({result:'NO_ACTIVE_MATCH',checkedAt,source:'CERT_TRIP_SEARCH',pcc:config.SABRE_PCC})}`]);
 }
 } finally {
 const close=body.replace('<Action>Trip_SearchRQ</Action>','<Action>SessionCloseRQ</Action>').replace(/<SOAP-ENV:Body>[\s\S]*<\/SOAP-ENV:Body>/,'<SOAP-ENV:Body><SessionCloseRQ Version="1.0.0" xmlns="http://www.opentravel.org/OTA/2002/11"/></SOAP-ENV:Body>');
 try {const response=await fetch('https://webservices.cert.platform.sabre.com',{method:'POST',headers:{'Content-Type':'text/xml; charset=utf-8',SOAPAction:'SessionCloseRQ'},body:close,signal:AbortSignal.timeout(20000),redirect:'error'});console.log(JSON.stringify({stage:'SESSION_CLOSE',httpStatus:response.status}));}catch{console.log(JSON.stringify({stage:'SESSION_CLOSE',completed:false}));}
 }
}finally{await db.close();}
