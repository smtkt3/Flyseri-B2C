import {Inject,Injectable,Optional} from '@nestjs/common';
import {TicketDocumentsService} from '../flight/ticket-documents.service.js';
import {queueTicketEmail,resolveTicketEmail} from '../flight/ticket-document.contract.js';
import {randomBytes} from 'node:crypto';
import {and,eq,sql} from 'drizzle-orm';
import {flightBookingIntents,flightBookings,flightServicingCases,flightServicingEvents,orders,orderItems,payments,adminAuditEvents,type DatabaseConnection} from '@flyseri/database';
import type {FlightOffer,FlightBookingProviderView} from '@flyseri/types';
import type {AppConfig} from '@flyseri/config';
import {ApiException} from '../api-exception.js';
import {APP_CONFIG,DATABASE_CONNECTION,SABRE_BOOKING_CLIENT} from '../tokens.js';
import {SabreBookingManagementClient,SabreExchangeUnconfirmedError,SabreBookingUnknownError,SabreBookingRejectedError} from '../flight/sabre-booking-management.client.js';
import {sanitizedTicketingErrors} from '../flight/ticketing-currency.contract.js';
import {FlightTicketingService} from '../flight/flight-ticketing.service.js';
import {exchangeRecordId,executableExchange,exchangeCents,exchangeItineraryMatches,reissueComplete,exchangedItineraryOffer,type ExchangeContext,type ExchangePqr} from '../flight/flight-exchange-execution.contract.js';
import type {ExchangeOffer,ExchangeSearch} from '../flight/flight-exchange-shopping.contract.js';
import type {AirlineEligibility} from '../flight/flight-servicing.contract.js';
import type {OperationAction,OperationQuote} from './admin-flight-operations.service.js';
import type {AdminIdentity} from './admin-auth.js';
import {CommerceRepository} from '../commerce/commerce.repository.js';
import {PaymentEngineService} from '../commerce/payment-engine.service.js';
import {StripeTestPaymentProvider} from '../commerce/stripe-test-payment.provider.js';
import {customerExchangeQuotation} from '../flight/customer-exchange-quotation.js';

const conflict=(message:string)=>new ApiException('CONFLICT',message,409);
type State={eligibility?:AirlineEligibility;exchangeSearch?:ExchangeSearch;exchangeOffer?:ExchangeOffer;exchangeBefore?:ExchangeContext;exchangePrepared?:ExchangeContext;pqrs?:ExchangePqr[];stage?:string;collectionOrderId?:string;[key:string]:unknown};
@Injectable()
export class AdminFlightExchangesService{
 constructor(@Inject(DATABASE_CONNECTION) private readonly connection:DatabaseConnection|undefined,@Inject(APP_CONFIG) private readonly config:AppConfig,@Inject(SABRE_BOOKING_CLIENT) private readonly sabre:SabreBookingManagementClient|undefined,@Inject(FlightTicketingService) private readonly ticketing:FlightTicketingService,@Optional() @Inject(TicketDocumentsService) private readonly ticketDocuments?:TicketDocumentsService){}
 private get db(){if(!this.connection)throw conflict('Exchange storage is unavailable');return this.connection.db;}
 async available(){
  if(!this.connection||!this.sabre||this.config.SABRE_ENV!=='CERT'||this.config.APP_ENV==='production'||this.config.FLIGHT_TICKET_SERVICING_EXECUTION_ENABLED!=='true'||this.config.PAYMENT_PROVIDER!=='STRIPE_TEST'||!this.config.STRIPE_SECRET_KEY?.startsWith('sk_test_'))return false;
  try{return JSON.parse(this.config.SABRE_TICKETING_PROFILE??'null')?.formOfPayment==='CASH'&&(await this.connection.pool.query("SELECT EXISTS(SELECT 1 FROM information_schema.columns WHERE table_name='orders' AND table_schema='public' AND column_name='flight_servicing_case_id') AS ready")).rows[0]?.ready===true&&(await this.ticketing.capabilities()).ticketIssuanceAvailable;}catch{return false;}
 }
 private async load(id:string,input:OperationAction,staff:AdminIdentity){
  if(!['owner','manager'].includes(staff.role))throw new ApiException('FORBIDDEN','A manager must authorize exchange execution.',403);
  if(!await this.available())throw new ApiException('DEPENDENCY_UNAVAILABLE','CERT exchange payment storage and ticketing configuration are required.',503);
  const [record]=await this.db.select().from(flightServicingCases).where(eq(flightServicingCases.id,id));
  const [booking]=record?await this.db.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)):[];
  if(!record||!booking||record.kind!=='EXCHANGE'||record.version!==input.version||!booking.pnrLocator||input.confirmedPnr!==booking.pnrLocator||!record.quote||!record.approval)throw conflict('Refresh the approved exchange case and confirm its PNR.');
  return {record,booking,state:(record.result??{}) as State,quote:record.quote as OperationQuote};
 }
 async sendQuotation(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
  const {record,booking,state}=await this.load(id,input,staff);
  if(record.status!=='EXECUTING'||state.stage!=='EXCHANGE_PAYMENT_PENDING'||!state.collectionOrderId)throw conflict('A verified additional-payment quotation is required before sending it to the client.');
  await this.db.transaction(async tx=>{
   const [order]=await tx.select().from(orders).where(eq(orders.id,state.collectionOrderId!)).for('update');
   const [current]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
   const [payment]=order?await tx.select().from(payments).where(eq(payments.orderId,order.id)):[];
   if(!current||current.version!==input.version||!order)throw conflict('The quotation changed. Refresh before sending it.');
   const quotation=customerExchangeQuotation({record:current,order,bookingCustomerId:booking.customerId,paymentStatus:payment?.status??null},Date.now(),true);
   if(!quotation||!['PAYMENT_REQUIRED','PAYMENT_PROCESSING'].includes(quotation.status))throw conflict('This quotation is expired, paid or needs review. No payment request was sent.');
   if((current.result as State).customerQuoteSentAt)return;
   await tx.update(flightServicingCases).set({result:{...(current.result as State),customerQuoteSentAt:new Date().toISOString()},version:current.version+1,updatedAt:new Date()}).where(eq(flightServicingCases.id,id));
   await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'CUSTOMER_QUOTATION_SENT',note:'Published additional-payment quotation in the customer account.'});
   await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.exchange.quotation_sent',resourceType:'flight_servicing_case',resourceId:id,requestId});
  });
 }
 async prepare(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
  const {record,booking,state,quote}=await this.load(id,input,staff);
  const approval=record.approval as {bookingUpdatedAt?:string;pnr?:string},offer=state.exchangeSearch?.offers.find(offer=>offer.reference===quote.evidenceReference);
  if(record.status!=='APPROVED'||booking.status!=='TICKETED'||approval.pnr!==booking.pnrLocator||approval.bookingUpdatedAt!==booking.updatedAt.toISOString()||Date.parse(quote.expiresAt)<=Date.now()||!state.exchangeSearch||Date.parse(state.exchangeSearch.reviewExpiresAt)<=Date.now()||!offer||!state.eligibility)throw conflict('Obtain a fresh airline exchange offer and approval before changing the itinerary.');
  const context=await this.sabre!.getExchangeContext(booking.pnrLocator!);
  executableExchange(offer,context,quote.exchangePricePolicy);
  const live=await this.sabre!.checkFlightTickets(booking.pnrLocator!,await this.sabre!.getTicketServicingContext(booking.pnrLocator!));
  const names=(await this.connection!.pool.query('SELECT booked_passenger_names FROM flight_bookings WHERE id=$1',[booking.id])).rows[0]?.booked_passenger_names as string[]|undefined;
  if(live.fingerprint!==state.eligibility.fingerprint||!live.atpcoFlightOnly||live.tickets.some(ticket=>ticket.changeable!==true)||context.bookingId!==(booking.sabreBookingId??booking.pnrLocator)||!Array.isArray(names)||context.travelers.length!==names.length||context.travelers.some((person,index)=>(person.givenName+' '+person.surname).trim().replace(/\s+/g,' ').toUpperCase()!==names[index]!.trim().replace(/\s+/g,' ').toUpperCase()))throw conflict('The booking identity or ticket eligibility changed. Search and approve again.');
  const next:State={...state,exchangeOffer:offer,exchangeBefore:context,stage:'EXCHANGE_COMMITTING'};
  await this.db.transaction(async tx=>{
   const [order]=await tx.select().from(orders).where(eq(orders.bookingIntentId,booking.bookingIntentId)).for('update');
   const [payment]=order?await tx.select().from(payments).where(eq(payments.orderId,order.id)).for('update'):[];
   if(!order||!payment||order.status!=='PAID'||payment.status!=='SUCCEEDED'||payment.provider!=='STRIPE_TEST'||order.customerId!==booking.customerId||payment.customerId!==booking.customerId||payment.currency!==order.currency||offer.currency!==order.currency||exchangeCents(payment.amount)!==exchangeCents(order.totalAmount)||offer.chargeType==='Refund'&&exchangeCents(offer.amount!)>exchangeCents(order.totalAmount))throw conflict('The original verified payment must cover this exchange and its refund currency.');
   const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,booking.id)).for('update');
   if(!locked||locked.updatedAt.getTime()!==booking.updatedAt.getTime()||locked.status!=='TICKETED')throw conflict('The booking changed during exchange preparation.');
   const [claimed]=await tx.update(flightServicingCases).set({status:'EXECUTING',result:next,version:record.version+1,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,input.version),eq(flightServicingCases.status,'APPROVED'))).returning();
   if(!claimed)throw conflict('The exchange was already claimed. Do not repeat it.');
   await tx.update(flightBookings).set({status:'MANUAL_REVIEW_REQUIRED',updatedAt:new Date()}).where(eq(flightBookings.id,booking.id));
   await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'EXCHANGE_COMMIT_CLAIMED'});
   await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.exchange.claimed',resourceType:'flight_servicing_case',resourceId:id,requestId});
  });
  try{
   // Exactly one mutation. Any exception after claiming remains locked.
   next.pqrs=await this.sabre!.exchangeBooking(booking.pnrLocator!,offer,context,quote.exchangePricePolicy);
   await this.db.update(flightServicingCases).set({result:next,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.status,'EXECUTING')));
   await this.finishPreparation(id,booking.id,booking.customerId,booking.pnrLocator!,next,staff);
  }catch(error){if(error instanceof SabreExchangeUnconfirmedError)next.exchangeDiagnostic=error.diagnostic;await this.unknown(id,next,'The itinerary change or PQR outcome needs reconciliation. Do not repeat the exchange.');}
 }
 private async finishPreparation(id:string,bookingId:string,customerId:string,pnr:string,state:State,staff:AdminIdentity){
  if(!state.exchangeBefore||!state.exchangeOffer||!state.pqrs?.length)throw conflict('PQR evidence was not returned. Keep the exchange locked for specialist reconciliation.');
  state.pqrs=state.pqrs.map(pqr=>({...pqr,id:exchangeRecordId(pqr.id)}));
  const current=await this.sabre!.getExchangeContext(pnr,state.exchangeBefore);
  if(current.bookingId!==state.exchangeBefore.bookingId||!exchangeItineraryMatches(current.view,state.exchangeOffer,state.exchangeBefore)||!state.pqrs.every(pqr=>{const fare=current.pqrRecords.find(fare=>fare.id===pqr.id),index=state.exchangeBefore!.tickets.find(ticket=>ticket.number===pqr.ticketNumber)!.travelerIndex;return fare?.active&&Boolean(fare.validatingAirlineCode)&&(fare.travelerIndices?.length===1&&fare.travelerIndices[0]===index||fare.travelerIndices===null&&current.travelers.length===1);}))throw conflict('The replacement itinerary or its passenger-specific PQR is not verified.');
  const collect=state.exchangeOffer.chargeType==='Add collect'&&exchangeCents(state.exchangeOffer.amount!)>0n;
  await this.db.transaction(async tx=>{
   const [locked]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
   if(!locked||!['EXECUTING','OUTCOME_UNKNOWN'].includes(locked.status))throw conflict('Exchange case changed.');
   let orderId=state.collectionOrderId;
   if(collect&&!orderId){
    const [prior]=await tx.select().from(orders).where(eq(orders.flightServicingCaseId,id)).limit(1);
    if(prior)throw conflict('An additional collection order already exists. Reconcile it before proceeding.');
    const expiresAt=new Date(Math.min(Date.now()+30*60000,...[state.exchangeOffer!.airlineExpiresAt].filter((value):value is string=>Boolean(value)).map(value=>Date.parse(value))));
    if(expiresAt.getTime()<=Date.now())throw conflict('The replacement fare expired before checkout.');
    const [order]=await tx.insert(orders).values({customerId,flightServicingCaseId:id,orderNumber:'SMEX-'+randomBytes(10).toString('hex').toUpperCase(),currency:state.exchangeOffer!.currency!,subtotalAmount:state.exchangeOffer!.amount!,totalAmount:state.exchangeOffer!.amount!,expiresAt}).returning();
    orderId=order!.id;
    await tx.insert(orderItems).values({orderId,itemType:'FLIGHT',referenceId:id,descriptionSnapshot:'Additional payment for flight exchange · '+pnr,quantity:1,unitAmount:state.exchangeOffer!.amount!,totalAmount:state.exchangeOffer!.amount!,currency:state.exchangeOffer!.currency!});
   }
   const next={...state,exchangePrepared:current,collectionOrderId:orderId,collectionPath:orderId?'/app/orders/'+orderId:null,stage:collect?'EXCHANGE_PAYMENT_PENDING':'EXCHANGE_READY_TO_REISSUE',message:collect?'Replacement itinerary and PQR verified. The customer must complete the separate additional-payment order before staff reissue.':'Replacement itinerary and PQR verified. Staff can now confirm reissue.'};
   await tx.update(flightServicingCases).set({status:'EXECUTING',result:next,version:locked.version+1,updatedAt:new Date()}).where(eq(flightServicingCases.id,id));
   await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'EXCHANGE_PQR_VERIFIED',note:state.pqrs!.map(pqr=>pqr.id).join(',')});
   await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot=${JSON.stringify(current.view)}::jsonb,last_sabre_refresh_at=now() WHERE id=${bookingId}::uuid`);
  });
 }
 async fulfill(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
  const {record,booking,state}=await this.load(id,input,staff);
  if(record.status!=='EXECUTING'||!['EXCHANGE_PAYMENT_PENDING','EXCHANGE_READY_TO_REISSUE'].includes(String(state.stage))||!state.exchangePrepared||!state.exchangeBefore||!state.exchangeOffer||!state.pqrs?.length||booking.status!=='MANUAL_REVIEW_REQUIRED')throw conflict('Verify the replacement itinerary and its payment before reissue.');
  if(state.collectionOrderId){
   const [payment]=await this.db.select().from(payments).where(eq(payments.orderId,state.collectionOrderId));
   if(!payment)throw conflict('The customer has not completed the additional-payment checkout.');
   await new PaymentEngineService(new CommerceRepository(this.connection!),new StripeTestPaymentProvider(this.config)).reconcile(payment.id);
  }
  const current=await this.sabre!.getExchangeContext(booking.pnrLocator!,state.exchangeBefore);
  if(current.fingerprint!==state.exchangePrepared.fingerprint)throw conflict('The itinerary, tickets or PQR pricing changed. Reconcile the exchange before reissue.');
  const sending:State={...state,stage:'EXCHANGE_REISSUING',reissueApi:'ENHANCED_AIR_TICKET'};
  await this.db.transaction(async tx=>{
   if(state.collectionOrderId){
    const [order]=await tx.select().from(orders).where(eq(orders.id,state.collectionOrderId)).for('update');
    const [payment]=await tx.select().from(payments).where(eq(payments.orderId,state.collectionOrderId)).for('update');
    if(!order||!payment||order.flightServicingCaseId!==id||order.customerId!==booking.customerId||payment.customerId!==booking.customerId||order.status!=='PAID'||order.fulfillmentStatus!=='NOT_STARTED'||payment.status!=='SUCCEEDED'||payment.provider!=='STRIPE_TEST'||!payment.providerPaymentId||order.currency!==state.exchangeOffer!.currency||payment.currency!==order.currency||exchangeCents(order.totalAmount)!==exchangeCents(state.exchangeOffer!.amount!)||exchangeCents(payment.amount)!==exchangeCents(order.totalAmount)||exchangeCents(order.discountAmount)!==0n)throw conflict('A verified, unexpired Stripe sandbox additional payment is required before reissue.');
   }
   const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,booking.id)).for('update');
   if(locked?.status!=='MANUAL_REVIEW_REQUIRED'||locked.updatedAt.getTime()!==booking.updatedAt.getTime())throw conflict('The booking changed before reissue.');
   const [claimed]=await tx.update(flightServicingCases).set({result:sending,version:record.version+1,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,input.version),eq(flightServicingCases.status,'EXECUTING'))).returning();
   if(!claimed)throw conflict('Reissue was already claimed. Do not submit it again.');
   await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'REISSUE_CLAIMED'});
   await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.reissue.claimed',resourceType:'flight_servicing_case',resourceId:id,requestId});
  });
  try{await this.ticketing.reissue(booking.pnrLocator!,state.pqrs.map(pqr=>({...pqr,validatingAirlineCode:state.exchangePrepared!.pqrRecords.find(fare=>fare.id===pqr.id)?.validatingAirlineCode})),state.exchangeBefore.travelers.flatMap(person=>[person.givenName,person.surname]));await this.finishReissue(id,booking.id,booking.pnrLocator!,sending,staff);}catch(error){
   if(error instanceof SabreBookingUnknownError||error instanceof SabreBookingRejectedError)sending.reissueDiagnostic={operation:'enhancedAirTicket',reason:error instanceof SabreBookingUnknownError?error.reason:'SUPPLIER_REQUEST_REJECTED',httpStatus:error.httpStatus,errors:sanitizedTicketingErrors(error instanceof SabreBookingUnknownError?error.diagnostic?.errors:error.diagnostics),warnings:sanitizedTicketingErrors(error instanceof SabreBookingUnknownError?error.diagnostic?.warnings:[]),supplierRequestId:error instanceof SabreBookingUnknownError?error.diagnostic?.supplierRequestId:error.supplierRequestId,automaticRetry:false};
   await this.unknown(id,sending,'Reissue outcome is uncertain. Verify ticket evidence; do not submit again.');
  }
 }
 private async finishReissue(id:string,bookingId:string,pnr:string,state:State,staff:AdminIdentity){
  const current=await this.sabre!.getBookingView(pnr,state.exchangeBefore);
  if(current.bookingId!==state.exchangeBefore?.bookingId||!state.exchangeOffer||!state.exchangeBefore||!reissueComplete(current.view,state.exchangeOffer,state.exchangeBefore))throw conflict('Replacement ticket and exchanged-coupon evidence is incomplete.');
  const pending=state.exchangeOffer.chargeType==='Refund'&&exchangeCents(state.exchangeOffer.amount!)>0n;
  const [reference]=await this.db.select({intentId:flightBookings.bookingIntentId}).from(flightBookings).where(eq(flightBookings.id,bookingId));
  if(!reference||!state.exchangeSearch?.journeys.length)throw conflict('The saved exchange journey is incomplete.');
  const [deliveryIntent]=await this.db.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,reference.intentId));
  const ticketRecipient=await resolveTicketEmail(deliveryIntent?.searchRequestSnapshot as Record<string,unknown>??{},current.bookingId,current.view,()=>this.sabre!.getPurchaseBooking(pnr));
  await this.db.transaction(async tx=>{
   const [intent]=await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,reference.intentId)).for('update');
   if(!intent)throw conflict('The original booking selection is unavailable.');
   if(state.collectionOrderId){
    const [order]=await tx.select().from(orders).where(eq(orders.id,state.collectionOrderId)).for('update');
    const [payment]=await tx.select().from(payments).where(eq(payments.orderId,state.collectionOrderId)).for('update');
    if(!order||!payment||order.flightServicingCaseId!==id||order.status!=='PAID'||payment.status!=='SUCCEEDED'||payment.provider!=='STRIPE_TEST'||payment.currency!==order.currency||order.currency!==state.exchangeOffer!.currency||exchangeCents(order.totalAmount)!==exchangeCents(state.exchangeOffer!.amount!)||exchangeCents(payment.amount)!==exchangeCents(order.totalAmount))throw conflict('Additional-payment evidence is missing during reissue reconciliation.');
   }
   const [lockedBooking]=await tx.select().from(flightBookings).where(eq(flightBookings.id,bookingId)).for('update');
   if(lockedBooking?.status!=='MANUAL_REVIEW_REQUIRED')throw conflict('Booking state changed during reissue reconciliation.');
   const [record]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
   if(!record||!['EXECUTING','OUTCOME_UNKNOWN'].includes(record.status))throw conflict('Reissue case changed during verification.');
   await tx.execute(sql`UPDATE flight_bookings SET status='TICKETED',provider_view_snapshot=${JSON.stringify(current.view)}::jsonb,last_sabre_refresh_at=now(),updated_at=now() WHERE id=${bookingId}::uuid AND status='MANUAL_REVIEW_REQUIRED'`);
    await tx.update(flightBookingIntents).set({searchRequestSnapshot:queueTicketEmail({...intent.searchRequestSnapshot as Record<string,unknown>,...(ticketRecipient?{checkoutContactEmail:ticketRecipient}:{}),servicedOffer:exchangedItineraryOffer(intent.selectedOfferSnapshot as FlightOffer,state.exchangeOffer!,state.exchangeSearch!.journeys)},bookingId,current.view),updatedAt:new Date()}).where(eq(flightBookingIntents.id,intent.id));
   if(state.collectionOrderId)await tx.update(orders).set({fulfillmentStatus:'COMPLETED',updatedAt:new Date()}).where(and(eq(orders.id,state.collectionOrderId),eq(orders.status,'PAID')));
   await tx.update(flightServicingCases).set({status:pending?'EXECUTING':'COMPLETED',result:{...state,stage:pending?'CUSTOMER_REFUND_PENDING':'COMPLETED',airlineCompleted:true,message:pending?'Replacement tickets and exchanged coupons verified. The approved customer refund remains pending.':'Replacement tickets and exchanged coupons verified. Exchange completed.'},version:record.version+1,updatedAt:new Date()}).where(eq(flightServicingCases.id,id));
   await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'REISSUE_VERIFIED'});
  });
   await this.ticketDocuments?.deliverAfterVerification(bookingId);
 }
 async reconcile(id:string,input:OperationAction,staff:AdminIdentity){
  const {record,booking,state}=await this.load(id,input,staff);
  if(record.status!=='OUTCOME_UNKNOWN'&&!(record.status==='EXECUTING'&&record.updatedAt.getTime()<Date.now()-300000))throw conflict('Only an uncertain or stalled exchange can be reconciled.');
  if(state.stage==='EXCHANGE_REISSUING')return this.finishReissue(id,booking.id,booking.pnrLocator!,state,staff);
  if(state.stage==='EXCHANGE_COMMITTING'){
   if(state.pqrs?.length)return this.finishPreparation(id,booking.id,booking.customerId,booking.pnrLocator!,state,staff);
   if(!state.exchangeBefore||!state.exchangeOffer)throw conflict('The saved exchange identity is incomplete. Keep this case locked.');
   // Even when the mutation response was lost, perform the promised read-only
   // refresh. An unchanged itinerary is diagnostic evidence, never retry permission.
   const current=await this.sabre!.getExchangeContext(booking.pnrLocator!,state.exchangeBefore);
   if(current.bookingId!==state.exchangeBefore.bookingId)throw conflict('The current Sabre booking identity does not match the saved exchange.');
   const flightKeys=(view:FlightBookingProviderView)=>view.flights.map(flight=>[flight.airlineCode,flight.flightNumber,flight.origin,flight.destination,flight.departureDate,flight.departureTime.slice(0,5),flight.arrivalDate,flight.arrivalTime.slice(0,5),flight.status]);
   const originalFlightsMatch=JSON.stringify(flightKeys(current.view))===JSON.stringify(flightKeys(state.exchangeBefore.view));
   const activePqrCount=current.pqrRecords.filter(pqr=>pqr.active).length;
   const verification={checkedAt:new Date().toISOString(),source:'SABRE_GET_BOOKING',bookingIdentityMatches:true,approvedItineraryMatches:exchangeItineraryMatches(current.view,state.exchangeOffer,state.exchangeBefore),originalFlightsMatch,activePqrCount,pqrCount:current.pqrRecords.length,automaticRetry:false,supplierMutationRepeated:false};
   const message=originalFlightsMatch&&!activePqrCount?'The latest Sabre read shows the original flights and no active replacement PQR. The prior exchange outcome remains unresolved. No additional payment or reissue was opened; keep this case locked.':'Current airline evidence was refreshed, but the original exchange response did not provide verified ticket-specific PQR amounts. Keep the case locked for specialist reconciliation; do not repeat the exchange.';
   await this.db.transaction(async tx=>{
    const [changed]=await tx.update(flightServicingCases).set({status:'OUTCOME_UNKNOWN',version:record.version+1,updatedAt:new Date(),result:{...state,exchangeReconciliation:verification,message}}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,input.version),sql`${flightServicingCases.result}->>'stage'='EXCHANGE_COMMITTING'`)).returning({id:flightServicingCases.id});
    if(!changed)throw conflict('The exchange case changed during verification.');
    await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'EXCHANGE_RECONCILIATION_PENDING',note:message});
   });
   return;
  }
  throw conflict('This exchange needs specialist reconciliation. No mutation was repeated.');
 }
 private async unknown(id:string,state:State,message:string){await this.db.update(flightServicingCases).set({status:'OUTCOME_UNKNOWN',result:{...state,message},version:sql`${flightServicingCases.version}+1`,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.status,'EXECUTING'),sql`${flightServicingCases.result}->>'stage'=${state.stage}`));}
}
