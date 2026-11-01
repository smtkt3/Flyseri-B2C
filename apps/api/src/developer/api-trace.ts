import {AsyncLocalStorage} from 'node:async_hooks';
import {randomUUID} from 'node:crypto';
import type {NextFunction,Request,Response} from 'express';
import {sanitizedTicketingErrors} from '../flight/ticketing-currency.contract.js';
import {enhancedTicketDiagnostics} from '../flight/enhanced-air-ticket.contract.js';
import {safeExchangeDiagnosticToken} from '../flight/exchange-diagnostic-tokens.js';
import {sabreTraceDefinitions,sabreTraceFields} from './trace-schema-fields.js';

type SafeValue=null|boolean|number|string|SafeValue[]|{[key:string]:SafeValue};
type CaptureMode='PENDING'|'JSON_REDACTED'|'EMPTY'|'OMITTED_SIZE'|'OMITTED_TYPE'|'UNAVAILABLE';
type IssueSummary={result:'WARNING'|'ERROR'|'NO_REPORTED_ISSUES'|'NOT_EVALUATED';source:'RESPONSE'|'STORED_CASE_DIAGNOSTIC';warningCount:number;errorCount:number;warnings:ReturnType<typeof sanitizedTicketingErrors>;errors:ReturnType<typeof sanitizedTicketingErrors>;descriptions:'SAFE_CLASSIFICATIONS_NOT_RAW_TEXT'};
export type ApiTrace={id:string;sequence:number;direction:'INCOMING'|'OUTGOING';method:string;endpoint:string;service:string;requestId?:string;supplierRequestId?:string;startedAt:string;headersReceivedAt?:string;capturedAt?:string;durationMs:number|null;status:number|null;state:'PENDING'|'COMPLETE'|'ERROR';requestCapture:CaptureMode;responseCapture:CaptureMode;request:SafeValue;response:SafeValue;diagnostics:IssueSummary};
const context=new AsyncLocalStorage<{requestId:string}>();
const MAX_BODY=32768,MAX_EVENTS=1000,RETENTION_MS=60*60*1000;
const privateKey=/password|secret|token|authorization|cookie|passport|document|travell?er|passenger|name|email|phone|address|card|payment|checkout|signature|credential|pnr|locator|confirmation|bookingId|customerId|staff|reference|number|message|description|note|text|content|url|link|prompt/i;
const structural=new Set([...sabreTraceFields,...'success data items results errors warnings error request response totalCount count page limit durationMs statusCode requestId correlationId httpStatus operation environment health ready checkedAt createdAt updatedAt expiresAt providerCodes descriptionFingerprint unclassifiedAirTicketMessage supplierRequestId lookupSupplierRequestId lastCheckRequestId quote approval result ticketingDiagnostic issuanceContext stage classification ticketCheck automaticRetry configuredPcc bookingPcc credentialPcc farePccs payableCurrency customerPaymentCurrency execution commitWaitMs quoteHandling lastCheckedAt lastSuccessfulLookupAt pccScope action version kind ticketing dispatch responseKeys permissions eprTicketing carrierStock printerDesignation settlement printerConfigured printerDesignationRequested identitySource effectiveIssuingPcc effectiveEpr endpoint requestSha256 sentAt receivedAt recordedAt approvedAt bookingUpdatedAt approvedQuoteVersion refundAmount serviceFee supplierPenalty additionalCollection residualAmount airlineCompleted confirmed claimedAt events event staffRole createdByStaffId'.split(' ')]);
const containers=new Set(['payment','payments','formsOfPayment','issuanceContext','operatorChecks']);
const enumFields=new Set('status code category type reason operation environment currency currencyCode targetPcc ticketingPcc userWorkPcc userHomePcc backDatePriceQuoteMethod priceQuoteExpirationMethod airlineCode validatingAirlineCode countryCode cabin ticketStatusName couponStatus pricingStatusName pricingStatusCode recordTypeCode method errorHandlingPolicy bookingSource notificationEmail configuredPcc bookingPcc credentialPcc farePccs payableCurrency customerPaymentCurrency quoteHandling stage classification ticketCheck pccScope action kind event identitySource eprTicketing carrierStock printerDesignation settlement effectiveIssuingPcc'.split(' '));
const numberFields=new Set('amount total totalCount count page limit durationMs statusCode httpStatus adults children infants primaryFormOfPayment secondaryFormOfPayment commitTicketToBookingWaitTime commitWaitMs documentCount errorCount warningCount version approvedQuoteVersion'.split(' '));
const dateFields=new Set('timestamp checkedAt createdAt updatedAt expiresAt creationDate creationTime departureDate departureTime arrivalDate arrivalTime purchaseDeadlineDate purchaseDeadlineTime ticketingDate ticketingTime sentAt receivedAt recordedAt approvedAt bookingUpdatedAt claimedAt'.split(' '));
for(const field of ['ticketRecovery','recovery','checks','reasons','reconciliationReasons','originalSupplierRequestId'])structural.add(field);
for(const field of 'AirTicketRQ AirTicketRS targetCity DesignatePrinter Printers Ticket Hardcopy InvoiceItinerary LNIATA CountryCode Itinerary ID Ticketing FOP_Qualifiers BasicFOP Type MiscQualifiers Commission Percent PricingQualifiers PriceQuote Record Number Reissue AirExtras EndNumber PostProcessing EndTransaction Source ReceivedFrom ApplicationResults Success Error Warning SystemSpecificResults Message ShortText Summary DocumentNumber DocumentType IssuingLocation Reservation FirstName LastName TotalAmount decimalPlace committed ticketingApi commissionPercent'.split(' '))structural.add(field);
enumFields.add('ticketingApi');numberFields.add('commissionPercent');numberFields.add('Percent');numberFields.add('decimalPlace');
for(const field of ['preSubmissionDiagnostic','supplierMutationAttempted','phase','databaseCode'])structural.add(field);
for(const field of ['initialTicketingDiagnostic','previousPreSubmissionDiagnostic','ticketIssued'])structural.add(field);
enumFields.add('phase');
enumFields.add('verification');numberFields.add('lookupCount');dateFields.add('lastCheckedAt');
// Every explicitly validated value must retain its real structural field name.
for(const field of [...enumFields,...numberFields,...dateFields,...containers,'fieldName','fieldPath'])structural.add(field);
const uuid=/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
function safePath(value:string){return value.length<=240&&/^[A-Za-z][A-Za-z0-9_.[\]]*$/.test(value)&&value.split(/[.[\]]/).filter(Boolean).every(part=>/^\d{1,3}$/.test(part)||structural.has(part)||sabreTraceDefinitions.has(part));}
/** Structural names and diagnostic values are independent allowlists; secrets never enter storage. */
export function redactTrace(value:unknown,key='',depth=0):SafeValue{
 // Enhanced Air Ticket's documented PQ record nesting reaches depth nine.
 if(depth>10)return '[DEPTH LIMIT]';
 if(value===null||value===undefined)return null;
 if(typeof value==='string'){
  if(key==='databaseCode')return /^[0-9A-Z]{5}$/.test(value)?value:'[REDACTED]';
  if(key==='version'&&/^\d{1,2}\.\d{1,2}\.\d{1,2}$/.test(value))return value;
  if(['targetCity','IssuingLocation'].includes(key)&&/^[A-Z0-9]{4}$/.test(value))return value;
  if(key==='CountryCode'&&/^[A-Z]{2}$/.test(value))return value;
  if(key==='Type'&&['CA','Transport','Validation','Application','BusinessLogic'].includes(value))return value;
  if(key==='DocumentType'&&['TKT','EMD','MSR'].includes(value))return value;
  if(key==='ReceivedFrom'&&/^[A-Z0-9]{4} WEB$/.test(value))return value;
  if(key==='providerCodes')return /^\d{4}$/.test(value)?value:'[REDACTED]';
  if(key==='providerMessageCodes')return /^(?:ERR|WARN)\.(?:SP|SWS)\.[A-Z_.]{1,80}$/.test(value)?value:'[REDACTED]';
  if(key==='supplierOperations')return ['AutomatedExchangesLLSRQ','OTA_AirBookLLSRQ','GetReservationRQ','EndTransactionLLSRQ','DisplayPriceQuoteLLSRQ','AirTicketLLSRQ'].includes(value)?value:'[REDACTED]';
  if(key==='descriptionSource')return ['CANONICAL_MATCH','PUBLIC_MESSAGE_HASH_MATCH'].includes(value)?value:'[REDACTED]';
  if(['actionOnPQExpired','actionOnBackDatePrice'].includes(key))return ['Q','R','O'].includes(value)?value:'[REDACTED]';
  if(key==='messageTokens')return safeExchangeDiagnosticToken(value)?value:'[REDACTED]';
  if(key==='descriptionFingerprint'||key==='requestSha256')return /^[a-f0-9]{64}$/.test(value)?value:'[REDACTED]';
  if(key==='responseKeys')return structural.has(value)?value:'[REDACTED]';
  if(key==='description')return sanitizedTicketingErrors([{description:value}])[0]?.description??'[REDACTED]';
  if(['currency','currencyCode','payableCurrency','customerPaymentCurrency'].includes(key))return /^[A-Z]{3}$/.test(value)?value:'[REDACTED]';
  if(['configuredPcc','bookingPcc','credentialPcc','targetPcc','ticketingPcc','userWorkPcc','userHomePcc'].includes(key))return /^[A-Z0-9]{3,4}$/.test(value)?value:'[REDACTED]';
  if(key==='supplierPaymentMethod')return ['CASH','INVOICE','PAYMENTCARD'].includes(value)?value:'[REDACTED]';
  if(['reason','reasons','reconciliationReasons'].includes(key))return /^[A-Z][A-Z0-9_]{1,63}$/.test(value)?value:'[REDACTED]';
  if(['fieldName','fieldPath'].includes(key))return safePath(value)?value:'[REDACTED]';
  if(['requestId','correlationId','supplierRequestId','originalSupplierRequestId','lookupSupplierRequestId','lastCheckRequestId'].includes(key)&&uuid.test(value))return value;
  if(key==='priceQuoteRecordIds'||key==='priceQuoteReissueRecordId'||key==='recordId')return /^[A-Z0-9]{1,3}$/.test(value)?value:'[REDACTED]';
  if(dateFields.has(key)&&/^(?:\d{4}-\d{2}-\d{2}(?:T\d{2}:\d{2}:\d{2}(?:\.\d{1,9})?(?:Z|[+-]\d{2}:\d{2}))?|\d{2}:\d{2}(?::\d{2})?)$/.test(value))return value;
 }
 if(key==='Number'&&typeof value==='number'&&Number.isInteger(value)&&value>=1&&value<=999)return value;
 const permitted=containers.has(key)||['ticketStatusName','primaryFormOfPayment','secondaryFormOfPayment','documentCount','fieldPath','fieldName','unclassifiedAirTicketMessage','printerDesignationRequested','DocumentType'].includes(key);
 if(privateKey.test(key)&&!permitted)return '[REDACTED]';
 if(value instanceof Date)return dateFields.has(key)&&Number.isFinite(value.getTime())?value.toISOString():'[REDACTED]';
 if(Array.isArray(value))return [...value.slice(0,25).map(item=>redactTrace(item,key,depth+1)),...(value.length>25?['[ARRAY TRUNCATED]']:[])];
 if(typeof value==='object'){
  const result:Record<string,SafeValue>={},entries=Object.entries(value);
  entries.slice(0,100).forEach(([field,item],index)=>{const known=structural.has(field)||privateKey.test(field);const label=known?field:`[unknown field ${index+1}]`;result[label]=field==='description'?sanitizedTicketingErrors([value])[0]?.description??'[REDACTED]':redactTrace(item,known?field:'',depth+1);});
  if(entries.length>100)result['[CAPTURE LIMIT]']='Additional fields omitted';return result;
 }
 if(typeof value==='boolean')return value;
 if(typeof value==='number')return numberFields.has(key)&&Number.isFinite(value)?value:'[REDACTED]';
 if(typeof value==='string'){
  if(enumFields.has(key)&&/^[A-Za-z0-9_ .:/-]{1,64}$/.test(value))return value;
  if(['amount','total','refundAmount','serviceFee','supplierPenalty','additionalCollection','residualAmount'].includes(key)&&/^\d{1,12}(\.\d{1,2})?$/.test(value))return value;
 }
 return '[REDACTED]';
}
export function traceIssues(value:unknown):IssueSummary{
 const raw=value&&typeof value==='object'?value as Record<string,unknown>:{};
 const enhanced=raw.AirTicketRS?enhancedTicketDiagnostics(raw):raw.ExchangeBookingRS?enhancedTicketDiagnostics({AirTicketRS:raw.ExchangeBookingRS}):raw.ApplicationResults?enhancedTicketDiagnostics({AirTicketRS:raw}):undefined;
 const data=raw.data as {status?:string;result?:{ticketingDiagnostic?:Record<string,unknown>;exchangeDiagnostic?:Record<string,unknown>;reissueDiagnostic?:Record<string,unknown>}}|undefined;
 const records=Array.isArray(data)?data:data?[data]:[];
 const stored=records.flatMap(record=>record?.status==='COMPLETED'?[]:[record?.result?.ticketingDiagnostic,record?.result?.exchangeDiagnostic,record?.result?.reissueDiagnostic]).filter((value):value is Record<string,unknown>=>!!value&&typeof value==='object');
 const source=stored.length&&!Array.isArray(raw.warnings)&&!Array.isArray(raw.errors)?'STORED_CASE_DIAGNOSTIC':'RESPONSE';
 const selected=source==='STORED_CASE_DIAGNOSTIC'?{warnings:stored.flatMap(record=>Array.isArray(record.warnings)?record.warnings:[]),errors:stored.flatMap(record=>Array.isArray(record.errors)?record.errors:[])}:enhanced??raw;
 const incomplete=raw.success===false||!!enhanced&&enhanced.status!=='Complete';
 const warningCount=Array.isArray(selected.warnings)?selected.warnings.length:0,errorCount=Array.isArray(selected.errors)?selected.errors.length:incomplete?1:0;
 return {result:errorCount||incomplete?'ERROR':warningCount?'WARNING':'NO_REPORTED_ISSUES',source,warningCount,errorCount,warnings:sanitizedTicketingErrors(selected.warnings),errors:sanitizedTicketingErrors(selected.errors),descriptions:'SAFE_CLASSIFICATIONS_NOT_RAW_TEXT'};
}
const notEvaluated=():IssueSummary=>({result:'NOT_EVALUATED',source:'RESPONSE',warningCount:0,errorCount:0,warnings:[],errors:[],descriptions:'SAFE_CLASSIFICATIONS_NOT_RAW_TEXT'});
type Captured={value:SafeValue;mode:CaptureMode;diagnostics?:IssueSummary};
function capture(value:unknown):Captured{
 if(value===undefined||value===null)return {value:null,mode:'EMPTY'};
 try{const safe=redactTrace(value);return Buffer.byteLength(JSON.stringify(safe),'utf8')>MAX_BODY?{value:'[LARGE BODY OMITTED]',mode:'OMITTED_SIZE',diagnostics:traceIssues(value)}:{value:safe,mode:'JSON_REDACTED',diagnostics:traceIssues(value)};}catch{return {value:'[CAPTURE UNAVAILABLE]',mode:'UNAVAILABLE'};}
}
function jsonBody(raw:unknown):Captured{
 if(typeof raw==='string'){if(Buffer.byteLength(raw,'utf8')>MAX_BODY)return {value:'[LARGE BODY OMITTED]',mode:'OMITTED_SIZE'};try{return capture(JSON.parse(raw));}catch{return {value:'[NON-JSON BODY OMITTED]',mode:'OMITTED_TYPE'};}}
 return raw===undefined||raw===null?{value:null,mode:'EMPTY'}:{value:'[NON-JSON BODY OMITTED]',mode:'OMITTED_TYPE'};
}
const routeWords=new Set('api v1 v2 v3 v1.1.0 admin flights search bookings servicing-cases actions refresh revalidate-payment validate reserve ticketing fulfillFlightTickets getBooking createBooking modifyBooking cancelBooking checkFlightTickets voidFlightTickets refundFlightTickets offers flightCheck getAncillaries price flightReshop exchange booking trip orders oauth token auth health ready live developer traces customer customers travellers trips documents visa assistance payments payment_intents refunds checkout sessions webhooks stripe holidays travel support-requests coupons points weather settings dashboard summary metrics search-activity capabilities audit crm-sync status ai conversations messages'.split(' '));
function endpoint(raw:string){try{return new URL(raw,'http://internal').pathname.split('/').map(part=>!part?'':routeWords.has(part)?part:':id').join('/');}catch{return '[INVALID ENDPOINT]';}}
function service(raw:string){try{const host=new URL(raw).hostname;if(host.endsWith('.sabre.com'))return 'SABRE';if(host==='api.stripe.com')return 'STRIPE';if(host.endsWith('.supabase.co'))return 'SUPABASE';if(['localhost','127.0.0.1','::1'].includes(host))return 'LOCAL';return 'EXTERNAL';}catch{return 'FLYSERI';}}
function isExcluded(raw:string){try{const path=new URL(raw,'http://internal').pathname;return /\/developer\/traces(?:\/|$)/.test(path)||/\/health(?:\/|$)/.test(path);}catch{return true;}}
function isAuthEndpoint(raw:string){try{return /\/(?:auth|oauth|token|login|sign-in|authorize|callback)(?:\/|$)/i.test(new URL(raw,'http://internal').pathname);}catch{return true;}}
const authOmitted=():Captured=>({value:'[AUTHENTICATION PAYLOAD OMITTED]',mode:'OMITTED_TYPE'});
class TraceBuffer{
 enabled=false;private events:ApiTrace[]=[];private sequence=0;readonly startedAt=new Date().toISOString();
 add(value:Omit<ApiTrace,'id'|'sequence'>){if(!this.enabled)return undefined;this.trim();const row:ApiTrace={...value,id:randomUUID(),sequence:++this.sequence};this.events.push(row);if(this.events.length>MAX_EVENTS)this.events.shift();return row;}
 snapshot(){this.trim();return {version:2,enabled:this.enabled,startedAt:this.startedAt,retentionMinutes:60,capacity:MAX_EVENTS,scope:'Current API process: incoming HTTP + outgoing fetch. Excludes database queries, other processes and historical traffic.',redacted:true,items:this.events.slice().reverse().map(row=>({id:row.id,sequence:row.sequence,direction:row.direction,method:row.method,endpoint:row.endpoint,service:row.service,requestId:row.requestId,supplierRequestId:row.supplierRequestId,startedAt:row.startedAt,durationMs:row.durationMs,status:row.status,state:row.state,requestCapture:row.requestCapture,responseCapture:row.responseCapture,providerResult:row.diagnostics.result,diagnosticSource:row.diagnostics.source,warningCount:row.diagnostics.warningCount,errorCount:row.diagnostics.errorCount}))};}
 detail(id:string){this.trim();return this.events.find(row=>row.id===id);}
 private trim(){const cutoff=Date.now()-RETENTION_MS;this.events=this.events.filter(row=>Date.parse(row.startedAt)>=cutoff);}
}
export const apiTraces=new TraceBuffer();
async function readResponse(response:globalThis.Response):Promise<Captured>{
 if(!/\bjson\b/i.test(response.headers.get('content-type')??''))return {value:'[NON-JSON RESPONSE OMITTED]',mode:'OMITTED_TYPE'};
 if(Number(response.headers.get('content-length'))>MAX_BODY)return {value:'[LARGE RESPONSE OMITTED]',mode:'OMITTED_SIZE'};
 const reader=response.clone().body?.getReader();if(!reader)return {value:null,mode:'EMPTY'};
 let length=0;const chunks:Uint8Array[]=[];let timer:ReturnType<typeof setTimeout>|undefined;
 try{return await Promise.race([new Promise<Captured>(resolve=>{timer=setTimeout(()=>resolve({value:'[RESPONSE CAPTURE TIME LIMIT]',mode:'UNAVAILABLE'}),1000);}), (async()=>{while(true){const part=await reader.read();if(part.done)break;length+=part.value.length;if(length>MAX_BODY)return {value:'[LARGE RESPONSE OMITTED]',mode:'OMITTED_SIZE'} as Captured;chunks.push(part.value);}return jsonBody(Buffer.concat(chunks).toString('utf8'));})()]);}
 catch{return {value:'[RESPONSE CAPTURE UNAVAILABLE]',mode:'UNAVAILABLE'};}
 finally{clearTimeout(timer);void reader.cancel().catch(()=>{});}
}
function setResponse(row:ApiTrace,captured:Captured){row.response=captured.value;row.responseCapture=captured.mode;row.capturedAt=new Date().toISOString();row.diagnostics=captured.diagnostics??notEvaluated();}
let installed=false;
/** Observe once; never replay, alter arguments, consume the original stream or delay callers. */
export function installApiTraceFetch(enabled:boolean){
 apiTraces.enabled=enabled;if(installed||!enabled)return;installed=true;const native=globalThis.fetch;
 globalThis.fetch=async(input,options)=>{
  const raw=typeof input==='string'||input instanceof URL?String(input):input.url;if(isExcluded(raw))return native(input,options);
  const authentication=isAuthEndpoint(raw),requestObjectBody=options?.body===undefined&&input instanceof globalThis.Request&&input.body!==null;
  const started=performance.now(),body=authentication?authOmitted():requestObjectBody?{value:'[REQUEST OBJECT BODY OMITTED]',mode:'OMITTED_TYPE'} as Captured:jsonBody(options?.body);
  const row=apiTraces.add({direction:'OUTGOING',method:String(options?.method??(input instanceof globalThis.Request?input.method:'GET')).toUpperCase().replace(/[^A-Z]/g,'').slice(0,12),endpoint:endpoint(raw),service:service(raw),requestId:context.getStore()?.requestId,startedAt:new Date().toISOString(),durationMs:null,status:null,state:'PENDING',requestCapture:body.mode,responseCapture:'PENDING',request:body.value,response:null,diagnostics:notEvaluated()});
  try{const response=await native(input,options);if(row){row.headersReceivedAt=new Date().toISOString();row.durationMs=Math.round(performance.now()-started);row.status=response.status;row.state=response.ok?'COMPLETE':'ERROR';const id=response.headers.get('x-request-id');if(id&&uuid.test(id))row.supplierRequestId=id;if(authentication)setResponse(row,authOmitted());else void readResponse(response).then(body=>setResponse(row,body)).catch(()=>setResponse(row,{value:'[RESPONSE CAPTURE UNAVAILABLE]',mode:'UNAVAILABLE'}));}return response;}
  catch(error){if(row){row.durationMs=Math.round(performance.now()-started);row.state='ERROR';setResponse(row,{value:{code:error instanceof Error&&['TimeoutError','AbortError'].includes(error.name)?'TIMEOUT_OR_ABORT':'TRANSPORT_FAILURE'},mode:'UNAVAILABLE'});}throw error;}
 };
}
export function apiTraceMiddleware(request:Request,response:Response,next:NextFunction){
 if(!apiTraces.enabled||isExcluded(request.path))return next();const started=performance.now(),requestId=(request as Request&{requestId?:string}).requestId;
 const row=apiTraces.add({direction:'INCOMING',method:request.method,endpoint:endpoint(request.path),service:'FLYSERI',requestId,startedAt:new Date().toISOString(),durationMs:null,status:null,state:'PENDING',requestCapture:'PENDING',responseCapture:'PENDING',request:null,response:null,diagnostics:notEvaluated()});
 const authentication=isAuthEndpoint(request.path),original=response.json;response.json=function(body:unknown){if(row)setResponse(row,authentication?authOmitted():capture(body));return original.call(this,body);};
 const finish=(aborted=false)=>{if(!row||row.state!=='PENDING')return;try{const pattern=request.route?.path;if(typeof pattern==='string'&&pattern.length<=240&&/^\/[A-Za-z0-9_:/.*-]+$/.test(pattern))row.endpoint=pattern;const body=authentication?authOmitted():capture(request.body);row.request=body.value;row.requestCapture=body.mode;row.durationMs=Math.round(performance.now()-started);row.status=aborted?null:response.statusCode;row.state=aborted||response.statusCode>=400?'ERROR':'COMPLETE';if(row.responseCapture==='PENDING')setResponse(row,{value:aborted?'[CONNECTION CLOSED]':'[NO JSON RESPONSE CAPTURED]',mode:aborted?'UNAVAILABLE':'OMITTED_TYPE'});}catch{/* Diagnostics must not fail a request. */}};
 response.once('finish',()=>finish());response.once('close',()=>finish(!response.writableFinished));context.run({requestId:requestId??randomUUID()},next);
}
