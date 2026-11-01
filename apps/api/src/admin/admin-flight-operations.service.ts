import { Inject, Injectable,Optional } from '@nestjs/common';
import {TicketDocumentsService} from '../flight/ticket-documents.service.js';
import { and, asc, count, desc, eq, ilike, inArray, or, sql, type SQL } from 'drizzle-orm';
import { auditEvents, adminAuditEvents, customers, flightBookingIntents, flightBookings, flightServicingCases, flightServicingEvents, orders, payments, refunds, type DatabaseConnection } from '@flyseri/database';
import type { FlightBookingProviderView, FlightOffer } from '@flyseri/types';
import { completedTicketCancellation, type AirlineEligibility } from '../flight/flight-servicing.contract.js';
import { exchangeJourneys, type ExchangeJourney, type ExchangeSearch } from '../flight/flight-exchange-shopping.contract.js';
import { SabreBookingManagementClient, selectCheckedAtpcoOffer } from '../flight/sabre-booking-management.client.js';
import { matchesConfirmedItinerary } from '../flight/reservation-evidence.js';
import type { AppConfig } from '@flyseri/config';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG, DATABASE_CONNECTION, SABRE_BOOKING_CLIENT } from '../tokens.js';
import { FlightBookingsService } from '../flight/flight-bookings.service.js';
import { FlightTicketingService, TicketingCurrencyRestrictionError, TicketingReconciliationError, TicketingPreSubmissionError } from '../flight/flight-ticketing.service.js';
import { AdminFlightsService } from './admin-flights.service.js';
import type { AdminIdentity } from './admin-auth.js';
import type { AdminListQuery } from './admin-records.service.js';
import { AdminFlightRefundsService } from './admin-flight-refunds.service.js';
import { contactChange, contactModificationComplete, prepareContactPlan, type ContactChange, type ContactPlan } from '../flight/flight-contact-modification.contract.js';
import {AdminFlightExchangesService} from './admin-flight-exchanges.service.js';
import { ticketingExecutionOptions, sameTicketingExecution, type TicketingExecutionOptions } from '../flight/ticketing-execution.contract.js';
import {confirmedAncillaryItems,requestKey,cents,fromCents,normalizeName,type AncillarySnapshot} from '../flight/ancillary-purchase.contract.js';
import {supportReconciliationEvidence,ticketingOperatorChecks,type SupportReconciliationEvidence} from '../flight/ticketing-diagnostics.contract.js';
import {completedIssuePresentation} from '../flight/completed-issue-presentation.js';
import {sanitizedTicketingErrors} from '../flight/ticketing-currency.contract.js';
import {readRetailPricing} from '../pricing/flight-pricing.contract.js';
import {queueTicketEmail,resolveTicketEmail} from '../flight/ticket-document.contract.js';

export type OperationKind = 'ISSUE'|'CANCEL'|'VOID'|'REFUND'|'EXCHANGE'|'MODIFY';
export type OperationQuote = { currency:string; amount:string; airlinePenalty:string; serviceFee:string; fareDifference:string; refundAmount:string; evidenceReference:string; expiresAt:string; itinerary?:string;exchangePricePolicy?:'EXACT_MATCH';ticketing?:TicketingExecutionOptions };
export type OperationAction = { action:'CHECK'|'RESHOP'|'PREPARE_CONTACT'|'QUOTE'|'APPROVE'|'EXECUTE'|'SEND_EXCHANGE_QUOTATION'|'FULFILL_EXCHANGE'|'RECONCILE'|'REFUND_CUSTOMER'|'PREPARE_REMAINING_CANCEL'|'EXECUTE_REMAINING_CANCEL'|'NOTE'|'CANCEL'|'RECORD_SUPPORT_EVIDENCE'; version:number; note?:string; confirmedPnr?:string; consentReference?:string; quote?:OperationQuote; journeys?:ExchangeJourney[]; contact?:ContactChange;supportEvidence?:SupportReconciliationEvidence };
const conflict = (message:string) => new ApiException('CONFLICT',message,409);
const invalid = (message:string) => new ApiException('VALIDATION_ERROR',message,400);
const permitted = (staff:AdminIdentity) => {if(!['owner','manager','ticketing_staff'].includes(staff.role))throw new ApiException('FORBIDDEN','Ticketing staff access is required.',403);};
const money = (amount:string) => { if(!/^(?:0|[1-9]\d{0,7})(?:\.\d{1,2})?$/.test(amount))throw invalid('Use a non-negative amount with up to two decimal places.');const [whole,decimal='']=amount.split('.');return BigInt(whole!)*100n+BigInt(decimal.padEnd(2,'0')); };
const active = ['OPEN','QUOTED','APPROVED','EXECUTING','FAILED','OUTCOME_UNKNOWN'];

@Injectable()
export class AdminFlightOperationsService {
  constructor(@Inject(DATABASE_CONNECTION) private readonly connection:DatabaseConnection|undefined,
    @Inject(APP_CONFIG) private readonly config:AppConfig,
    @Inject(FlightTicketingService) private readonly ticketing:FlightTicketingService,
    @Inject(SABRE_BOOKING_CLIENT) private readonly sabre:SabreBookingManagementClient|undefined,
    @Inject(AdminFlightRefundsService) private readonly customerRefunds:AdminFlightRefundsService,
    @Inject(FlightBookingsService) private readonly bookings:FlightBookingsService,
    @Inject(AdminFlightsService) private readonly records:AdminFlightsService,
    @Inject(AdminFlightExchangesService) private readonly exchanges?:AdminFlightExchangesService,
    @Optional() @Inject(TicketDocumentsService) private readonly ticketDocuments?:TicketDocumentsService) {}
  private get db(){if(!this.connection)throw new ApiException('DEPENDENCY_UNAVAILABLE','Flight operations database is unavailable.',503);return this.connection.db;}
  async capabilities(){
    let caseManagementAvailable=false;
    try{const result=await this.connection?.pool.query("SELECT to_regclass('public.flight_servicing_cases') IS NOT NULL AND to_regclass('public.flight_servicing_events') IS NOT NULL AS ready");caseManagementAvailable=result?.rows[0]?.ready===true;}catch{/* Missing or unreadable evidence keeps the operation restricted. */}
    const issuance=await this.ticketing.capabilities();
    const reservation=this.bookings.capabilities();
    const servicing=Boolean(this.sabre&&caseManagementAvailable&&this.config.APP_ENV!=='production'&&this.config.SABRE_ENV==='CERT'&&this.config.FLIGHT_TICKET_SERVICING_EXECUTION_ENABLED==='true'&&this.ticketing.servicingPrinters());
    let contactStorage=false;
    try{const result=await this.connection?.pool.query("SELECT pg_get_constraintdef(oid) LIKE '%MODIFY%' AS ready FROM pg_constraint WHERE conrelid='public.flight_servicing_cases'::regclass AND conname='flight_servicing_cases_kind_check'");contactStorage=result?.rows[0]?.ready===true;}catch{/* Missing or unreadable evidence keeps the operation restricted. */}
    return {environment:this.config.SABRE_ENV, sandbox:this.config.SABRE_ENV==='CERT',caseManagementAvailable,supportEvidenceRecordingAvailable:caseManagementAvailable&&this.config.SABRE_ENV==='CERT',
      contactModificationAvailable:Boolean(contactStorage&&this.sabre&&reservation.reservationAvailable&&this.config.SABRE_ENV==='CERT'&&this.config.APP_ENV!=='production'),
      ticketIssuanceAvailable:issuance.ticketIssuanceAvailable,automaticTicketingEnabled:issuance.automaticTicketingEnabled,customerTicketingEnabled:issuance.customerTicketingEnabled,unticketedCancellationAvailable:reservation.reservationAvailable,
      defaultAtpcoTicketingApi:issuance.ticketIssuanceAvailable&&this.ticketing.supportsEnhancedTicketing()?'ENHANCED_AIR_TICKET':'BOOKING_MANAGEMENT',
      airlineEligibilityAvailable:Boolean(this.sabre&&this.config.SABRE_ENV==='CERT'),exchangeShoppingAvailable:Boolean(this.sabre&&this.config.SABRE_ENV==='CERT'),customerRefundSettlementAvailable:this.customerRefunds.available(),voidExecutionAvailable:servicing,refundExecutionAvailable:servicing,exchangeExecutionAvailable:await this.exchanges?.available()??false,
      ticketingMessage:issuance.ticketingMessage,
      servicingMessage:'CERT servicing requires current ATPCO ticket evidence and manager approval. Exchange commits the approved itinerary and PQR first; verified additional payment precedes a separate reissue confirmation. Customer refunds are settled separately.'};
  }
  private async ready(){if(!(await this.capabilities()).caseManagementAvailable)throw new ApiException('DEPENDENCY_UNAVAILABLE','Flight servicing storage requires the saved database migration.',503);}
  async list(bookingId?:string){
    await this.ready();
    const records=await this.db.select().from(flightServicingCases).where(bookingId?eq(flightServicingCases.bookingId,bookingId):undefined).orderBy(desc(flightServicingCases.updatedAt),desc(flightServicingCases.id)).limit(200);
    return records.map(completedIssuePresentation);
  }
  async queue(query:AdminListQuery){
    await this.ready();
    const filters:SQL[]=[];
    if(query.status==='CUSTOMER_REFUND_PENDING')filters.push(and(inArray(flightServicingCases.status,['EXECUTING','OUTCOME_UNKNOWN']),sql`${flightServicingCases.result}->>'airlineCompleted'='true'`)!);
    else if(query.status)filters.push(eq(flightServicingCases.status,query.status));
    if(query.search)filters.push(or(ilike(flightBookings.pnrLocator,'%'+query.search+'%'),ilike(customers.displayName,'%'+query.search+'%'),sql`${flightServicingCases.id}::text ilike ${'%'+query.search+'%'}`)!);
    const where=filters.length?and(...filters):undefined;
    const [items,total]=await Promise.all([
      this.db.select({id:flightServicingCases.id,bookingId:flightServicingCases.bookingId,kind:flightServicingCases.kind,status:flightServicingCases.status,stage:sql<string|null>`${flightServicingCases.result}->>'stage'`,reason:flightServicingCases.reason,updatedAt:flightServicingCases.updatedAt,pnr:flightBookings.pnrLocator,customerName:customers.displayName}).from(flightServicingCases).innerJoin(flightBookings,eq(flightServicingCases.bookingId,flightBookings.id)).innerJoin(customers,eq(flightBookings.customerId,customers.id)).where(where).orderBy(desc(flightServicingCases.updatedAt),desc(flightServicingCases.id)).limit(query.limit).offset((query.page-1)*query.limit),
      this.db.select({count:count()}).from(flightServicingCases).innerJoin(flightBookings,eq(flightServicingCases.bookingId,flightBookings.id)).innerJoin(customers,eq(flightBookings.customerId,customers.id)).where(where),
    ]);
    return {items,total:total[0]?.count??0,page:query.page,limit:query.limit};
  }
  async detail(id:string){
    const [record]=await this.db.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).limit(1);
    if(!record)throw new ApiException('NOT_FOUND','Servicing case not found.',404);
    const events=await this.db.select().from(flightServicingEvents).where(eq(flightServicingEvents.caseId,id)).orderBy(asc(flightServicingEvents.createdAt),asc(flightServicingEvents.id));
    const presented=completedIssuePresentation(record);
    if(presented.result&&typeof presented.result==='object'){
      const result={...presented.result as Record<string,unknown>};
      for(const key of ['exchangeDiagnostic','reissueDiagnostic'])if(result[key]&&typeof result[key]==='object'){
        const diagnostic=result[key] as Record<string,unknown>;
        result[key]={...diagnostic,errors:sanitizedTicketingErrors(diagnostic.errors),warnings:sanitizedTicketingErrors(diagnostic.warnings)};
      }
      return {...presented,result,events};
    }
    return {...presented,events};
  }
  async create(bookingId:string,kind:OperationKind,reason:string,staff:AdminIdentity,requestId:string){
    permitted(staff);await this.ready();
    if(kind==='MODIFY'&&!(await this.capabilities()).contactModificationAvailable)throw conflict('Contact servicing requires the contact-case migration and CERT booking connection.');
    if(reason.trim().length<3||reason.trim().length>2000)throw invalid('Enter a reason of 3–2,000 characters.');
    const id=await this.db.transaction(async tx=>{
      const [booking]=await tx.select().from(flightBookings).where(eq(flightBookings.id,bookingId)).for('update');
      if(!booking)throw new ApiException('NOT_FOUND','Booking not found.',404);
      if(!booking.pnrLocator)throw conflict('Reconcile this booking attempt and its PNR before opening an airline servicing case.');
      const [intent]=await tx.select({snapshot:flightBookingIntents.searchRequestSnapshot}).from(flightBookingIntents).where(eq(flightBookingIntents.id,booking.bookingIntentId));
      if(['CLAIMED','UNKNOWN'].includes(((intent?.snapshot as AncillarySnapshot)?.checkoutAncillaryPurchase?.documentAttempt?.status)??''))throw conflict('Reconcile the existing extra-service document attempt before another airline operation.');
      const existing=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.bookingId,bookingId));
      if(existing.some(item=>item.kind===kind&&active.includes(item.status)))throw conflict('An active case already exists for this operation. Open that case.');
      if(existing.some(item=>['APPROVED','EXECUTING','OUTCOME_UNKNOWN'].includes(item.status)))throw conflict('Resolve the approved or uncertain servicing operation on this booking first.');
      if(kind==='ISSUE'&&!['PAID','AWAITING_STAFF_TICKETING'].includes(booking.status))throw conflict('Ticket issuance requires a paid reservation ready for staff ticketing.');
      if(kind==='MODIFY'&&!['PNR_CREATED','AWAITING_PAYMENT','PAID','AWAITING_STAFF_TICKETING','TICKETED'].includes(booking.status))throw conflict('Resolve this reservation before modifying its contacts.');
      if(['VOID','REFUND','EXCHANGE'].includes(kind)&&booking.status!=='TICKETED')throw conflict('This operation requires verified issued tickets. Refresh and reconcile the booking first.');
      if(kind==='CANCEL'&&!['PNR_CREATED','AWAITING_PAYMENT','PAID','AWAITING_STAFF_TICKETING'].includes(booking.status))throw conflict('Cancellation requires a confirmed unticketed reservation without an uncertain operation.');
      if(kind==='CANCEL'){
        const [order]=await tx.select().from(orders).where(eq(orders.bookingIntentId,booking.bookingIntentId)).limit(1);
        if(order&&(order.status!=='PAID'||order.fulfillmentStatus!=='NOT_STARTED'||!['PAID','AWAITING_STAFF_TICKETING'].includes(booking.status)))throw conflict('Resolve any pending payment or fulfillment before cancelling this reservation.');
      }
      const [record]=await tx.insert(flightServicingCases).values({bookingId,kind,reason:reason.trim(),createdByStaffId:staff.staffUserId}).returning();
      await tx.insert(flightServicingEvents).values({caseId:record!.id,staffUserId:staff.staffUserId,event:'OPENED',note:reason.trim()});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.servicing.opened',resourceType:'flight_servicing_case',resourceId:record!.id,requestId});
      return record!.id;
    });return this.detail(id);
  }
  /** Read-only airline checks recover an expired checkout, never an uncertain mutation. */
  async revalidatePaidBooking(id:string,staff:AdminIdentity,requestId:string){
    permitted(staff);await this.ready();
    if(!['owner','manager'].includes(staff.role)||!this.sabre||this.config.SABRE_ENV!=='CERT'||this.config.APP_ENV==='production')throw conflict('Manager access and Sabre CERT are required.');
    const booking=await this.records.booking(id);
    if(booking.status!=='MANUAL_REVIEW_REQUIRED'||booking.fulfillmentStatus!=='REVALIDATION_REQUIRED'||!booking.pnr||booking.passengerNamesSource!=='BOOKED_SNAPSHOT')throw conflict('This booking is not an expired paid checkout.');
    const cases=await this.list(id);
    if(cases.length)throw conflict('This booking has servicing history. Reconcile its existing case instead.');
    const [intent]=await this.db.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,booking.bookingIntentId)).limit(1);
    const offer=booking.selectedOffer as FlightOffer;
    const snapshot=intent?.searchRequestSnapshot as (AncillarySnapshot & {adults:number;children:number;infants:number})|undefined;
    if(!intent?.validatedTotalAmount||offer.ndcContext)throw conflict('Expired checkout recovery requires an ATPCO reservation.');
    const extras=snapshot?.checkoutAncillaryPurchase,hasExtras=Boolean(snapshot?.checkoutAncillaryRequests?.length||extras);
    if(hasExtras){
      if(!extras||extras.status!=='CONFIRMED'||!extras.items.length||extras.currency!==intent.currency||extras.requestKey!==requestKey(snapshot?.checkoutAncillaryRequests??[])||extras.documentAttempt&&extras.documentAttempt.status!=='NOT_STARTED')throw conflict('The existing extras require specialist reconciliation before payment recovery.');
      const current=await this.sabre.getPurchaseBooking(booking.pnr);
      if(current.bookingId!==extras.bookingId||current.bookingId!==(booking.sabreBookingId??booking.pnr)||current.travelers.length!==booking.passengerNames.length||current.travelers.some((person,index)=>normalizeName(String(person.givenName)+' '+String(person.surname))!==normalizeName(booking.passengerNames[index]!)))throw conflict('The extra-service reservation or travelers changed.');
      try{
        const evidence=confirmedAncillaryItems(current,extras.plans,snapshot?.checkoutAncillaryRequests??[]);
        const count=current.travelers.reduce((sum,person)=>sum+(Array.isArray(person.ancillaries)?person.ancillaries.length:0),0);
        if(count!==evidence.length||evidence.length!==extras.items.length||extras.items.some(item=>item.providerAncillaryIds.length!==1||!evidence.some(actual=>actual.requestId===item.requestId&&item.providerAncillaryIds.includes(actual.itemId)&&actual.currency===item.airlineCurrency&&cents(actual.amount)===cents(item.airlineAmount)))||cents(extras.extrasAmount)!==extras.items.reduce((sum,item)=>sum+cents(item.checkoutAmount),0n))throw Error('Changed extras');
      }catch{throw conflict('The attached airline extras or their prices changed. Keep this paid reservation under review.');}
    }
    let acceptedAmount:string;
    try{acceptedAmount=readRetailPricing((intent.searchRequestSnapshot as {retailPricing?:unknown}).retailPricing,intent.validatedTotalAmount,intent.currency)?.sellingTotal??intent.validatedTotalAmount;
      if(extras)acceptedAmount=fromCents(money(acceptedAmount)+money(extras.extrasAmount));}
    catch{throw conflict('The accepted retail pricing needs review before payment recovery.');}
    const servicing=await this.sabre.getTicketServicingContext(booking.pnr);
    if(!(hasExtras?servicing.atpcoUnticketed:servicing.atpcoUnticketedFlightOnly)||servicing.bookingId!==(booking.sabreBookingId??booking.pnr))throw conflict('The airline reservation contains ticket or service content requiring specialist review.');
    const context=await this.sabre.getTicketingContext(booking.pnr);
    const names=booking.passengerNames;
    if(context.bookingId!==(booking.sabreBookingId??booking.pnr)||!context.view.cancellationCheckComplete||context.view.tickets.length||!names.length||context.view.travellers.length!==names.length||context.view.travellers.some((p,i)=>(p.givenName+' '+p.surname).trim().replace(/\s+/g,' ').toUpperCase()!==names[i]!.trim().replace(/\s+/g,' ').toUpperCase())||!matchesConfirmedItinerary(context.view,offer)||context.selection.currency!==intent.currency||money(context.selection.totalAmount)!==money(intent.validatedTotalAmount))throw conflict('The stored airline fare or reservation changed. Specialist review is required.');
    const checked=selectCheckedAtpcoOffer(await this.sabre.flightCheck(offer,[...Array.from({length:snapshot!.adults},()=> 'ADT' as const),...Array.from({length:snapshot!.children},()=> 'CNN' as const),...Array.from({length:snapshot!.infants},()=> 'INF' as const)]),offer,this.config.SABRE_PCC!);
    if(checked.currency!==intent.currency||money(checked.totalAmount)!==money(intent.validatedTotalAmount)||checked.validUntil&&Date.parse(checked.validUntil)<=Date.now())throw conflict('The current airline fare changed or expired. Do not issue this paid reservation.');
    await this.db.transaction(async tx=>{
      const [lockedIntent]=await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,intent.id)).for('update');
      const [order]=await tx.select().from(orders).where(eq(orders.bookingIntentId,intent.id)).for('update').limit(1);
      const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,id)).for('update');
      const history=await tx.select({id:flightServicingCases.id}).from(flightServicingCases).where(eq(flightServicingCases.bookingId,id)).limit(1);
      const paid=order?await tx.select().from(payments).where(eq(payments.orderId,order.id)):[];
      const payment=paid.find(p=>p.status==='SUCCEEDED'&&p.provider==='STRIPE_TEST'&&p.paidAt&&p.customerId===order?.customerId&&p.amount===order.totalAmount&&p.currency===order.currency);
      const refunded=order?await tx.select({id:refunds.id}).from(refunds).where(and(eq(refunds.orderId,order.id),inArray(refunds.status,['REQUESTED','PROCESSING','SUCCEEDED']))).limit(1):[];
      if(refunded.length)throw conflict('A customer refund is already pending or completed. Keep this reservation under review.');
      if(JSON.stringify((lockedIntent?.searchRequestSnapshot as AncillarySnapshot|undefined)?.checkoutAncillaryPurchase)!==JSON.stringify(extras)||JSON.stringify((lockedIntent?.searchRequestSnapshot as AncillarySnapshot|undefined)?.checkoutAncillaryRequests)!==JSON.stringify(snapshot?.checkoutAncillaryRequests))throw conflict('The attached extras changed during payment recovery.');
      if(JSON.stringify((lockedIntent?.searchRequestSnapshot as {retailPricing?:unknown}|undefined)?.retailPricing)!==JSON.stringify((intent.searchRequestSnapshot as {retailPricing?:unknown}).retailPricing))throw conflict('The accepted retail pricing changed during payment recovery.');
      if(!locked||locked.updatedAt.toISOString()!==booking.updatedAt||locked.status!=='MANUAL_REVIEW_REQUIRED'||history.length||!order||order.cancelledAt||order.customerId!==booking.customerId||order.status!=='PAID'||order.fulfillmentStatus!=='REVALIDATION_REQUIRED'||!order.expiresAt||!order.paidAt||order.expiresAt>order.paidAt||!payment||lockedIntent?.validatedTotalAmount!==intent.validatedTotalAmount||lockedIntent.currency!==intent.currency||money(order.totalAmount)+money(order.discountAmount)!==money(acceptedAmount)||order.currency!==intent.currency)throw conflict('Payment, booking or servicing evidence changed. Keep this reservation under review.');
      await tx.update(orders).set({fulfillmentStatus:'NOT_STARTED',updatedAt:new Date()}).where(eq(orders.id,order.id));
      await tx.update(flightBookings).set({status:'AWAITING_STAFF_TICKETING',lastSabreRefreshAt:new Date(),updatedAt:new Date()}).where(eq(flightBookings.id,id));
      await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot=${JSON.stringify(context.view)}::jsonb WHERE id=${id}::uuid`);
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.paid_checkout.revalidated',resourceType:'flight_booking',resourceId:id,requestId});
    });
    return this.records.booking(id);
  }
  private validateQuote(quote:OperationQuote,kind:string,currency:string){
    if(['currency','amount','airlinePenalty','serviceFee','fareDifference','refundAmount','evidenceReference','expiresAt'].some(key=>typeof (quote as unknown as Record<string,unknown>)[key]!=='string'))throw invalid('Complete every quote field using text values.');
    if(Object.keys(quote).some(key=>!['currency','amount','airlinePenalty','serviceFee','fareDifference','refundAmount','evidenceReference','expiresAt','itinerary','ticketing','exchangePricePolicy'].includes(key)))throw invalid('The quote contains unsupported fields.');
    if(quote.exchangePricePolicy!==undefined&&(kind!=='EXCHANGE'||quote.exchangePricePolicy!=='EXACT_MATCH'))throw invalid('Exact-match exchange pricing applies only to an EXCHANGE case.');
    if(kind==='ISSUE'){try{quote.ticketing=ticketingExecutionOptions(quote.ticketing);}catch(error){throw invalid((error as Error).message);}}
    else if(quote.ticketing!==undefined)throw invalid('Ticket issuance options apply only to an ISSUE case.');
    if(quote.itinerary!==undefined&&typeof quote.itinerary!=='string')throw invalid('Record the proposed itinerary as text.');
    if(quote.currency!==currency)throw invalid('Use the booking currency. Cross-currency servicing needs a separate verified conversion workflow.');
    for(const amount of [quote.amount,quote.airlinePenalty,quote.serviceFee,quote.fareDifference,quote.refundAmount])money(amount);
    const expiry=Date.parse(quote.expiresAt);
    if(!/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/.test(quote.expiresAt)||!Number.isFinite(expiry)||expiry<=Date.now()||expiry>Date.now()+86400000)throw invalid('The quote must use a UTC expiry within the next 24 hours.');
    if(!quote.evidenceReference.trim()||quote.evidenceReference.length>300)throw invalid('Record the airline fare-rule or quote evidence reference.');
    if(kind==='CANCEL'&&[quote.airlinePenalty,quote.fareDifference].some(value=>money(value)!==0n))throw invalid('Unticketed cancellation cannot collect an airline penalty or additional fare.');
    if(kind==='ISSUE'&&[quote.airlinePenalty,quote.serviceFee,quote.fareDifference,quote.refundAmount].some(value=>money(value)!==0n))throw invalid('Issuance uses the already-paid order. Additional charges or refunds require a separate financial workflow.');
    if(kind==='EXCHANGE'&&(!quote.itinerary?.trim()||quote.itinerary.length>2000))throw invalid('Record the proposed itinerary and the airline quote reference.');
    if(kind==='REFUND'&&money(quote.refundAmount)<=0n)throw invalid('Record the proposed customer refund amount.');
  }
  async action(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
    permitted(staff);await this.ready();
    if(((await this.detail(id)).result as {scope?:string}|null)?.scope==='ANCILLARY')throw conflict('Use the dedicated extra refund controls. Flight-wide servicing cannot operate this case.');
    if(input.action==='RECORD_SUPPORT_EVIDENCE')return this.recordSupportEvidence(id,input,staff,requestId);
    if(input.action==='EXECUTE')return this.execute(id,input,staff,requestId);
    if(input.action==='RECONCILE')return this.reconcile(id,input,staff,requestId);
    if(input.action==='CHECK')return this.check(id,input,staff,requestId);
    if(input.action==='RESHOP')return this.reshop(id,input,staff,requestId);
    if(input.action==='PREPARE_CONTACT')return this.prepareContact(id,input,staff,requestId);
    if(input.action==='SEND_EXCHANGE_QUOTATION'){if(!this.exchanges)throw conflict('Exchange execution is unavailable.');await this.exchanges.sendQuotation(id,input,staff,requestId);return this.detail(id);}
    if(input.action==='FULFILL_EXCHANGE'){if(!this.exchanges)throw conflict('Exchange execution is unavailable.');await this.exchanges.fulfill(id,input,staff,requestId);return this.detail(id);}
    if(input.action==='REFUND_CUSTOMER'){await this.customerRefunds.settle(id,input.version,input.confirmedPnr,staff,requestId);return this.detail(id);}
    if(input.action==='PREPARE_REMAINING_CANCEL'||input.action==='EXECUTE_REMAINING_CANCEL')return this.remainingCancellation(id,input,staff,requestId);
    const record=await this.detail(id);
    const booking=await this.records.booking(record.bookingId);
    if(input.action==='QUOTE'){
      if(record.kind==='MODIFY')throw invalid('Use the contact form to prepare this modification. Financial quotes are not supported for contact changes.');
      if(!input.quote)throw invalid('Complete the servicing quote.');this.validateQuote(input.quote,record.kind,booking.orderCurrency||booking.currency);
      if(record.kind==='ISSUE'&&(!booking.orderTotal||booking.orderCurrency!==input.quote.currency||money(input.quote.amount)!==money(booking.orderTotal)))throw invalid('The issuance amount must match the verified order total and currency.');
      if(record.kind==='REFUND'&&(!booking.orderTotal||money(input.quote.refundAmount)>money(booking.orderTotal)))throw invalid('The proposed refund cannot exceed the original order total.');
      if(['VOID','REFUND'].includes(record.kind))this.validateAirlineQuote(input.quote,record.kind,record.result as {eligibility?:AirlineEligibility}|null,booking.orderTotal);
      if(record.kind==='EXCHANGE')this.validateExchangeQuote(input.quote,record.result as {exchangeSearch?:ExchangeSearch}|null);
      if(record.kind==='CANCEL')this.validateUnticketedQuote(input.quote,booking);
    }
    await this.db.transaction(async tx=>{
      const [lockedBooking]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
      const [current]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
      if(!current||current.version!==input.version)throw conflict('This case changed. Refresh it before continuing.');
      if(input.action!=='NOTE'&&['EXECUTING','COMPLETED','OUTCOME_UNKNOWN','CANCELLED'].includes(current.status))throw conflict('This operation is locked. Review its recorded outcome before another action.');
      let patch:Partial<typeof flightServicingCases.$inferInsert>={updatedAt:new Date(),version:current.version+1};
      if(input.action==='QUOTE')patch={...patch,status:'QUOTED',quote:input.quote,approval:null};
      if(input.action==='APPROVE'){
        if(!lockedBooking||lockedBooking.updatedAt.toISOString()!==booking.updatedAt)throw conflict('The booking changed. Refresh before approving this quote.');
        if(!['owner','manager'].includes(staff.role))throw new ApiException('FORBIDDEN','A manager must approve the quote.',403);
        if(current.status!=='QUOTED'||!current.quote||Date.parse((current.quote as OperationQuote).expiresAt)<=Date.now())throw conflict('Prepare a current quote before approval.');
        if(input.confirmedPnr!==booking.pnr||!input.consentReference?.trim()||input.consentReference.length>300)throw invalid('Confirm the PNR and record the customer approval evidence reference.');
        const others=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.bookingId,current.bookingId));
        if(others.some(item=>item.id!==id&&['APPROVED','EXECUTING','OUTCOME_UNKNOWN'].includes(item.status)))throw conflict('Resolve the other approved or uncertain case first.');
        patch={...patch,status:'APPROVED',approval:{staffUserId:staff.staffUserId,approvedAt:new Date().toISOString(),consentReference:input.consentReference.trim(),pnr:booking.pnr,bookingUpdatedAt:booking.updatedAt,quoteVersion:current.version,...(record.kind==='ISSUE'?{ticketing:ticketingExecutionOptions((current.quote as OperationQuote).ticketing)}:{})}};
      }
      if(input.action==='NOTE'&&(!input.note?.trim()||input.note.length>2000))throw invalid('Enter an internal note of up to 2,000 characters.');
      if(input.action==='CANCEL')patch={...patch,status:'CANCELLED'};
      let eventNote=input.note?.trim()||null;
      if(input.action==='QUOTE'){
        const quote=input.quote!;
        eventNote=`Currency: ${quote.currency}\nQuoted amount: ${quote.amount}\nAirline penalty: ${quote.airlinePenalty}\nService fee: ${quote.serviceFee}\nAdditional fare collection: ${quote.fareDifference}\nProposed customer refund: ${quote.refundAmount}\nEvidence: ${quote.evidenceReference}\nExpires: ${quote.expiresAt}${quote.itinerary?'\nProposed itinerary: '+quote.itinerary:''}${quote.ticketing?'\nStored fare handling: '+quote.ticketing.quoteHandling+'; commit wait: '+quote.ticketing.commitWaitMs+' ms; price increases disabled':''}`;
        if(quote.ticketing)eventNote+='\nTicketing API: '+(quote.ticketing.ticketingApi??'BOOKING_MANAGEMENT')+'\nCommission: '+(quote.ticketing.commissionPercent===undefined?'Not overridden':quote.ticketing.commissionPercent+'%');
      }
      if(input.action==='APPROVE')eventNote=`Customer consent: ${input.consentReference!.trim()}\nConfirmed PNR: ${input.confirmedPnr}\nApproved quote version: ${current.version}`;
      await tx.update(flightServicingCases).set(patch).where(eq(flightServicingCases.id,id));
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:input.action,note:eventNote});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.servicing.'+input.action.toLowerCase(),resourceType:'flight_servicing_case',resourceId:id,requestId});
    });return this.detail(id);
  }
  private async prepareContact(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
    if(!(await this.capabilities()).contactModificationAvailable)throw conflict('Contact modification is unavailable.');
    const record=await this.detail(id),booking=await this.records.booking(record.bookingId);
    if(record.kind!=='MODIFY'||record.version!==input.version||!['OPEN','QUOTED','APPROVED','FAILED'].includes(record.status)||!booking.pnr||!['PNR_CREATED','AWAITING_PAYMENT','PAID','AWAITING_STAFF_TICKETING','TICKETED'].includes(booking.status))throw conflict('Refresh this contact case before preparing changes.');
    let change:ContactChange;
    try{change=contactChange(input.contact);}catch(error){throw invalid((error as Error).message);}
    const context=await this.sabre!.getContactContext(booking.pnr);
    if(context.bookingId!==(booking.sabreBookingId??booking.pnr)||!booking.passengerNames.length||context.travelers.length!==booking.passengerNames.length||context.travelers.some((person,index)=>(person.givenName+' '+person.surname).trim().replace(/\s+/g,' ').toUpperCase()!==booking.passengerNames[index]!.trim().replace(/\s+/g,' ').toUpperCase())||!matchesConfirmedItinerary(context.view,booking.selectedOffer as FlightOffer))throw conflict('The airline booking does not match the stored passenger and itinerary evidence.');
    const plan=prepareContactPlan(context,change,booking.status);
    const quote:OperationQuote={currency:booking.orderCurrency||booking.currency,amount:'0',airlinePenalty:'0',serviceFee:'0',fareDifference:'0',refundAmount:'0',evidenceReference:plan.reference,expiresAt:plan.expiresAt};
    await this.db.transaction(async tx=>{
      const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
      if(!locked||locked.updatedAt.toISOString()!==booking.updatedAt)throw conflict('The booking changed while preparing this modification.');
      const [changed]=await tx.update(flightServicingCases).set({status:'QUOTED',approval:null,quote,result:{contactPlan:plan,message:'Contact change prepared. Customer consent and manager approval are required.'},version:record.version+1,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,input.version),inArray(flightServicingCases.status,['OPEN','QUOTED','APPROVED','FAILED']))).returning({id:flightServicingCases.id});
      if(!changed)throw conflict('The case changed. Refresh before preparing again.');
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'CONTACT_PREPARED',note:`Traveler ${change.travelerIndex+1}: ${change.email}; ${change.phone}. Replaces this traveler's email and phone only. Reference ${plan.reference}`});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.servicing.contact_prepared',resourceType:'flight_servicing_case',resourceId:id,requestId});
    });return this.detail(id);
  }
  private async modifyContact(id:string,input:OperationAction,staff:AdminIdentity,requestId:string,reconcile=false){
    if(!['owner','manager'].includes(staff.role)||!(await this.capabilities()).contactModificationAvailable)throw conflict('Manager access and the CERT contact capability are required.');
    const record=await this.detail(id),booking=await this.records.booking(record.bookingId),plan=(record.result as {contactPlan?:ContactPlan}|null)?.contactPlan;
    const approval=record.approval as {pnr?:string;bookingUpdatedAt?:string}|null;
    if(record.kind!=='MODIFY'||!plan||!booking.pnr||input.confirmedPnr!==booking.pnr||input.version!==record.version||!approval||approval.pnr!==booking.pnr)throw conflict('Refresh this case and confirm its approved PNR.');
    if(reconcile){
      if(record.status!=='OUTCOME_UNKNOWN'&&!(record.status==='EXECUTING'&&record.updatedAt.getTime()<Date.now()-300000))throw conflict('Only an uncertain or stalled modification can be reconciled.');
    }else if(record.status!=='APPROVED'||Date.parse(plan.expiresAt)<=Date.now()||approval.bookingUpdatedAt!==booking.updatedAt||booking.status!==plan.previousStatus)throw conflict('The contact plan changed or expired. Prepare and approve it again.');
    const context=await this.sabre!.getContactContext(booking.pnr);
    if(!reconcile){
      // Validate the signature before the durable claim; the supplier checks it again.
      const current=prepareContactPlan(context,plan.change,plan.previousStatus);
      if(current.signatureHash!==plan.signatureHash||current.baseline!==plan.baseline)throw conflict('The airline booking changed. Prepare a fresh contact plan.');
      await this.db.transaction(async tx=>{
        // Serialize against initial order creation before locking the booking.
        await tx.select({id:flightBookingIntents.id}).from(flightBookingIntents).where(eq(flightBookingIntents.id,booking.bookingIntentId)).for('update');
        const [currentOrder]=await tx.select({id:orders.id}).from(orders).where(eq(orders.bookingIntentId,booking.bookingIntentId)).limit(1);
        if((currentOrder?.id??null)!==booking.orderId)throw conflict('Checkout changed while preparing this modification. Refresh it first.');
        const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
        if(!locked||locked.updatedAt.toISOString()!==booking.updatedAt)throw conflict('The booking changed.');
        const [claimed]=await tx.update(flightServicingCases).set({status:'EXECUTING',version:record.version+1,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,input.version),eq(flightServicingCases.status,'APPROVED'))).returning({id:flightServicingCases.id});
        if(!claimed)throw conflict('The operation is already claimed.');
        await tx.update(flightBookings).set({status:'MANUAL_REVIEW_REQUIRED',updatedAt:new Date()}).where(eq(flightBookings.id,record.bookingId));
        await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'CONTACT_EXECUTION_CLAIMED'});
      });
    }
    let confirmed=false,view=context.view;
    try{
      if(!reconcile)await this.sabre!.modifyTravelerContact(booking.pnr,context,plan);
      const after=reconcile?context:await this.sabre!.getContactContext(booking.pnr);
      confirmed=contactModificationComplete(after,plan);view=after.view;
    }catch{/* Retain uncertainty. Never retry a supplier mutation. */}
    if(reconcile&&!confirmed)throw conflict('The airline has not confirmed the exact approved contact update with unchanged flights and tickets. Keep this case locked.');
    await this.db.transaction(async tx=>{
      const [currentOrder]=await tx.select().from(orders).where(eq(orders.bookingIntentId,booking.bookingIntentId)).for('update');
      const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
      const [current]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
      if(!locked||locked.status!=='MANUAL_REVIEW_REQUIRED'||!current||!['EXECUTING','OUTCOME_UNKNOWN'].includes(current.status)||(reconcile&&current.version!==input.version))throw conflict('The operation needs reconciliation because its saved state changed.');
      if(confirmed){
        // A payment webhook may arrive during the supplier call. Preserve the
        // financial transition instead of restoring an obsolete unpaid status.
        const restoreStatus=currentOrder&&['CANCELLED','EXPIRED'].includes(currentOrder.status)||currentOrder?.fulfillmentStatus==='REVALIDATION_REQUIRED'?'MANUAL_REVIEW_REQUIRED':
          currentOrder?.status==='PAID'&&['PNR_CREATED','AWAITING_PAYMENT'].includes(plan.previousStatus)?'AWAITING_STAFF_TICKETING':plan.previousStatus;
        await tx.update(flightBookings).set({status:restoreStatus,lastSabreRefreshAt:new Date(),updatedAt:new Date()}).where(eq(flightBookings.id,record.bookingId));
        await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot=${JSON.stringify(view)}::jsonb WHERE id=${record.bookingId}::uuid`);
      }
      const message=confirmed?'Traveler contact update verified with Sabre. Flights, passenger identity and tickets are unchanged.':'Contact update outcome is uncertain. Verify the existing operation; do not send it again.';
      await tx.update(flightServicingCases).set({status:confirmed?'COMPLETED':'OUTCOME_UNKNOWN',version:current.version+1,result:{contactPlan:plan,message},updatedAt:new Date()}).where(eq(flightServicingCases.id,id));
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:confirmed?'CONTACT_VERIFIED':'CONTACT_UNKNOWN',note:message});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:confirmed?'flight.servicing.contact_verified':'flight.servicing.contact_unknown',resourceType:'flight_servicing_case',resourceId:id,requestId});
    });return this.detail(id);
  }
  private validateUnticketedQuote(quote:OperationQuote,booking:Awaited<ReturnType<AdminFlightsService['booking']>>){
    if(!booking.orderId){
      if([quote.amount,quote.serviceFee,quote.refundAmount].some(value=>money(value)!==0n))throw invalid('An unpaid reservation has no customer payment to refund.');
      return;
    }
    if(booking.orderStatus!=='PAID'||booking.paymentStatus!=='SUCCEEDED'||booking.fulfillmentStatus!=='NOT_STARTED'||!booking.orderTotal||booking.orderCurrency!==quote.currency||money(quote.amount)!==money(booking.orderTotal)||money(quote.refundAmount)+money(quote.serviceFee)!==money(booking.orderTotal))throw conflict('The cancellation quote must match the verified paid order. Refund plus retained service fee must equal the paid total.');
  }
  private validateAirlineQuote(quote:OperationQuote,kind:string,result:{eligibility?:AirlineEligibility}|null,orderTotal:string|null){
    const evidence=result?.eligibility;
    if(!evidence||Date.parse(evidence.expiresAt)<=Date.now()||quote.evidenceReference!==evidence.reference||Date.parse(quote.expiresAt)>Date.parse(evidence.expiresAt))throw conflict('Check current airline eligibility, use its reference and keep the quote within the airline-check expiry.');
    if(!evidence.atpcoFlightOnly)throw conflict('Online execution currently supports full ATPCO flight-only reservations. Other content needs specialist servicing.');
    if(!orderTotal||money(quote.refundAmount)>money(orderTotal)||money(quote.fareDifference)!==0n)throw invalid('Keep the customer refund within the original order. Cancellation cannot collect an additional fare.');
    if(kind==='VOID'){
      if(!evidence.tickets.every(ticket=>ticket.voidable===true)||money(quote.airlinePenalty)!==0n)throw conflict('Every ticket must be currently voidable without an airline refund penalty.');
      if(money(quote.amount)!==money(orderTotal)||money(quote.refundAmount)+money(quote.serviceFee)!==money(orderTotal))throw invalid('For a void, customer refund plus retained service fee must equal the original paid order.');
    }else{
      if(!evidence.tickets.every(ticket=>ticket.refundable===true&&ticket.automatedRefundEligible===true&&ticket.refundTotal?.currency===quote.currency))throw conflict('Every ticket must support an automated refund in the order currency. Unsupported or cross-currency refunds need specialist review.');
      const net=evidence.tickets.reduce((sum,ticket)=>sum+money(ticket.refundTotal!.amount),0n);
      if(money(quote.amount)!==net||money(quote.refundAmount)+money(quote.serviceFee)!==net)throw invalid('Customer refund plus retained service fee must match the current airline refundable total.');
      const fees=evidence.tickets.map(ticket=>ticket.refundFee);
      if(fees.every(fee=>fee?.currency===quote.currency)&&money(quote.airlinePenalty)!==fees.reduce((sum,fee)=>sum+money(fee!.amount),0n))throw invalid('The airline penalty must match the reported refund fees.');
    }
  }
  private validateExchangeQuote(quote:OperationQuote,result:{exchangeSearch?:ExchangeSearch}|null){
    const search=result?.exchangeSearch,offer=search?.offers.find(item=>item.reference===quote.evidenceReference);
    if(!search||Date.parse(search.reviewExpiresAt)<=Date.now()||!offer||Date.parse(quote.expiresAt)>Date.parse(search.reviewExpiresAt)||offer.airlineExpiresAt&&Date.parse(offer.airlineExpiresAt)<Date.parse(quote.expiresAt))throw conflict('Search current exchange offers and use an offer reference within its review and airline expiry.');
    if(offer.chargeType==='Unknown'||offer.amount===null||offer.currency!==quote.currency||offer.splitBooking||offer.mixedCabins||!offer.ticketPrices||!offer.priceGuaranteed&&quote.exchangePricePolicy!=='EXACT_MATCH')throw conflict('This offer needs specialist pricing, currency or passenger-split review before an executable quote.');
    if(money(quote.amount)!==money(offer.amount)||money(quote.fareDifference)!==(offer.chargeType==='Add collect'?money(offer.amount):0n)||money(quote.refundAmount)!==(offer.chargeType==='Refund'?money(offer.amount):0n)||money(quote.serviceFee)!==0n||money(quote.airlinePenalty)!==money(offer.airlineFee??'0'))throw invalid('Use the selected airline offer amounts. Additional agency fees require a separately verified collection workflow.');
    const itinerary=offer.flights.map(flight=>`${flight.airline} ${flight.number} ${flight.origin}-${flight.destination} ${flight.departureDate} ${flight.departureTime} / ${flight.bookingClasses.join(',')||'class unconfirmed'}`).join('\n');
    if(quote.itinerary!==itinerary)throw invalid('Use the exact selected airline offer itinerary.');
  }
  private async reshop(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
    const record=await this.detail(id);
    if(record.kind!=='EXCHANGE'||!['OPEN','QUOTED','APPROVED','FAILED'].includes(record.status)||record.version!==input.version)throw conflict('Open an editable exchange case before searching replacement flights.');
    let journeys:ExchangeJourney[];try{journeys=exchangeJourneys(input.journeys);}catch(error){throw invalid((error as Error).message);}
    const booking=await this.records.booking(record.bookingId);
    if(booking.status!=='TICKETED')throw conflict('A ticketed booking is required for Flight Reshop.');
    let search:ExchangeSearch,eligibility:AirlineEligibility;
    try{
      const current=await this.inspectEligibility(booking);eligibility=current.eligibility;
      if(!eligibility.atpcoFlightOnly||eligibility.tickets.length>9||eligibility.tickets.some(ticket=>ticket.changeable!==true)||current.context.view.tickets.some(ticket=>ticket.status!=='Issued'))throw conflict('Flight Reshop requires 1–9 changeable ATPCO tickets issued by the current agency, with no attached extras.');
      search=await this.sabre!.reshopFlightTickets(booking.pnr!,eligibility,journeys);
    }catch(error){if(error instanceof ApiException)throw error;throw new ApiException('DEPENDENCY_UNAVAILABLE','Sabre CERT could not return complete exchange offers. No itinerary or ticket was changed.',503);}
    await this.db.transaction(async tx=>{
      const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
      if(!locked||locked.updatedAt.toISOString()!==booking.updatedAt)throw conflict('The booking changed while searching. Refresh and search again.');
      const [changed]=await tx.update(flightServicingCases).set({status:'OPEN',quote:null,approval:null,version:record.version+1,updatedAt:new Date(),result:{eligibility,exchangeSearch:search,stage:'EXCHANGE_OFFERS',message:search.offers.length?'Airline exchange offers retrieved. The current itinerary and tickets are unchanged.':'Sabre returned no supported exchange offers for these dates. The current itinerary and tickets are unchanged.'}}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,input.version))).returning({id:flightServicingCases.id});
      if(!changed)throw conflict('The case changed while searching. Refresh before continuing.');
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'EXCHANGE_OFFERS_RETRIEVED',note:search.reference+' · '+search.offers.length+' offers\n'+journeys.map(journey=>`${journey.origin}-${journey.destination} ${journey.departureDate}`).join('\n')});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.servicing.exchange_shopped',resourceType:'flight_servicing_case',resourceId:id,requestId});
    });return this.detail(id);
  }
  private async inspectEligibility(booking:Awaited<ReturnType<AdminFlightsService['booking']>>){
    if(!this.sabre||!booking.pnr||this.config.SABRE_ENV!=='CERT')throw new ApiException('DEPENDENCY_UNAVAILABLE','Sabre CERT ticket eligibility is unavailable.',503);
    const context=await this.sabre.getTicketServicingContext(booking.pnr);
    if(booking.sabreBookingId&&booking.sabreBookingId!==context.bookingId)throw conflict('The airline returned a different booking. Reconcile it first.');
    if(!booking.passengerNames.length||context.view.travellers.length!==booking.passengerNames.length||context.view.travellers.some((person,index)=>[person.givenName,person.surname].join(' ').trim().replace(/\s+/g,' ').toUpperCase()!==booking.passengerNames[index]!.trim().replace(/\s+/g,' ').toUpperCase()))throw conflict('Booked passenger evidence must match the current PNR before ticket servicing.');
    if(!context.ticketNumbers.length||context.ticketNumbers.length>12)throw conflict('This check requires 1–12 verified electronic tickets.');
    if(context.ticketingPccs.some(pcc=>pcc!==this.config.SABRE_PCC))context.atpcoFlightOnly=false;
    const eligibility=await this.sabre.checkFlightTickets(booking.pnr,context);
    return {context,eligibility};
  }
  private async check(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
    const record=await this.detail(id);
    if(!['VOID','REFUND','EXCHANGE'].includes(record.kind)||!['OPEN','QUOTED','APPROVED','FAILED'].includes(record.status)||record.version!==input.version)throw conflict('Only an editable void, refund or exchange case can be checked.');
    const booking=await this.records.booking(record.bookingId);
    let eligibility:AirlineEligibility;
    try{({eligibility}=await this.inspectEligibility(booking));}catch(error){if(error instanceof ApiException)throw error;throw new ApiException('DEPENDENCY_UNAVAILABLE','Sabre could not provide complete ticket eligibility. No airline change was sent.',503);}
    await this.db.transaction(async tx=>{
      const [updated]=await tx.update(flightServicingCases).set({status:'OPEN',quote:null,approval:null,result:{eligibility,message:'Airline eligibility checked. Prepare a quote before approval.'},version:record.version+1,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,input.version))).returning({id:flightServicingCases.id});
      if(!updated)throw conflict('The case changed while checking eligibility. Refresh before continuing.');
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'ELIGIBILITY_CHECKED',note:eligibility.reference+' · expires '+eligibility.expiresAt});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.servicing.eligibility_checked',resourceType:'flight_servicing_case',resourceId:id,requestId});
    });return this.detail(id);
  }
  private async execute(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
    if(!['owner','manager'].includes(staff.role))throw new ApiException('FORBIDDEN','A manager must execute an approved servicing case.',403);
    const record=await this.detail(id);
    if(record.kind==='MODIFY')return this.modifyContact(id,input,staff,requestId);
    if(record.kind==='EXCHANGE'){if(!this.exchanges)throw conflict('Exchange execution is unavailable.');await this.exchanges.prepare(id,input,staff,requestId);return this.detail(id);}
    const capabilities=await this.capabilities();
    if(!capabilities.sandbox)throw new ApiException('DEPENDENCY_UNAVAILABLE','This workspace executes only in the Sabre CERT sandbox.',503);
    if(!['ISSUE','CANCEL','VOID','REFUND'].includes(record.kind))throw new ApiException('DEPENDENCY_UNAVAILABLE','Exchange execution requires a verified reissue quote and payment workflow. No airline transaction was sent.',503);
    if(record.kind==='ISSUE'&&!capabilities.ticketIssuanceAvailable||record.kind==='CANCEL'&&!capabilities.unticketedCancellationAvailable||record.kind==='VOID'&&!capabilities.voidExecutionAvailable||record.kind==='REFUND'&&!capabilities.refundExecutionAvailable)throw new ApiException('DEPENDENCY_UNAVAILABLE','The required sandbox provider capability is not configured. No operation was sent.',503);
    const booking=await this.records.booking(record.bookingId);
    const approval=record.approval as {pnr?:string;bookingUpdatedAt?:string}|null;
    if(record.status!=='APPROVED'||record.version!==input.version||!record.quote||Date.parse((record.quote as OperationQuote).expiresAt)<=Date.now()||!approval||approval.pnr!==booking.pnr||approval.bookingUpdatedAt!==booking.updatedAt||input.confirmedPnr!==booking.pnr)throw conflict('Refresh and re-approve the current booking and quote before executing.');
    const quote=record.quote as OperationQuote;
    if(record.kind==='ISSUE'){
      const approved=(record.approval as {ticketing?:TicketingExecutionOptions})?.ticketing,execution=ticketingExecutionOptions(quote.ticketing);
      if(!sameTicketingExecution(approved,execution))throw conflict('Approve the current ticket execution policy before issuance.');
    }
    const priorResult=(record.result??{}) as {eligibility?:AirlineEligibility;[key:string]:unknown};
    const ticketCancellation=record.kind==='VOID'||record.kind==='REFUND';
    const paidCancellation=record.kind==='CANCEL'&&Boolean(booking.orderId);
    if(record.kind==='CANCEL')this.validateUnticketedQuote(quote,booking);
    if(paidCancellation){
      if(!['PAID','AWAITING_STAFF_TICKETING'].includes(booking.status))throw conflict('The reservation must still be awaiting ticket issuance.');
      const context=await this.sabre!.getTicketServicingContext(booking.pnr!);
      const names=booking.passengerNames;
      if(!context.atpcoUnticketedFlightOnly||context.bookingId!==(booking.sabreBookingId??booking.pnr)||!names.length||context.view.travellers.length!==names.length||context.view.travellers.some((person,index)=>[person.givenName,person.surname].join(' ').trim().replace(/\s+/g,' ').toUpperCase()!==names[index]!.trim().replace(/\s+/g,' ').toUpperCase())||!matchesConfirmedItinerary(context.view,booking.selectedOffer as FlightOffer))throw conflict('Paid cancellation requires a matching, unticketed ATPCO flight-only reservation without extras.');
      priorResult.unticketedCancellation={bookingId:context.bookingId,orderId:booking.orderId,verifiedAt:new Date().toISOString()};
    }
    if(ticketCancellation){
      if(booking.status!=='TICKETED')throw conflict('Refresh and reconcile the booking before ticket cancellation. A verified ticketed reservation is required.');
      this.validateAirlineQuote(quote,record.kind,priorResult,booking.orderTotal);
      const {eligibility}=await this.inspectEligibility(booking);
      if(eligibility.fingerprint!==priorResult.eligibility?.fingerprint)throw conflict('The current airline rules, amount or PNR changed. Check eligibility and obtain a new approval.');
      if(!this.ticketing.servicingPrinters())throw conflict('The approved servicing printer is unavailable.');
    }
    await this.db.transaction(async tx=>{
      if(paidCancellation){
        const [order]=await tx.select().from(orders).where(eq(orders.id,booking.orderId!)).for('update');
        const [payment]=await tx.select().from(payments).where(and(eq(payments.orderId,booking.orderId!),eq(payments.status,'SUCCEEDED'))).for('update');
        if(!order||!payment||order.status!=='PAID'||order.fulfillmentStatus!=='NOT_STARTED'||order.customerId!==booking.customerId||payment.customerId!==booking.customerId||payment.provider!=='STRIPE_TEST'||payment.currency!==order.currency||quote.currency!==order.currency||money(payment.amount)!==money(order.totalAmount)||money(quote.amount)!==money(order.totalAmount))throw conflict('The original verified payment changed. Refresh before cancellation.');
      }
      const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
      if(!locked||locked.updatedAt.toISOString()!==booking.updatedAt)throw conflict('The booking changed during execution preparation.');
      const [claimed]=await tx.update(flightServicingCases).set({status:'EXECUTING',result:priorResult,version:record.version+1,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,input.version),eq(flightServicingCases.status,'APPROVED'))).returning();
      if(!claimed)throw conflict('This case was already claimed. Do not submit it again.');
      if(ticketCancellation||paidCancellation)await tx.update(flightBookings).set({status:'MANUAL_REVIEW_REQUIRED',updatedAt:new Date()}).where(eq(flightBookings.id,record.bookingId));
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'EXECUTION_CLAIMED'});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.servicing.execution_claimed',resourceType:'flight_servicing_case',resourceId:id,requestId});
    });
    let outcome='OUTCOME_UNKNOWN',message='The provider outcome requires reconciliation. Do not repeat this operation.';
    let completedView:FlightBookingProviderView|undefined;
    let airlineCompleted=false;
    try{
      if(ticketCancellation){
        const kind=record.kind as 'VOID'|'REFUND',numbers=priorResult.eligibility!.tickets.map(ticket=>ticket.number);
        const response=await this.sabre!.cancelTicketedBooking(booking.pnr!,kind,this.ticketing.servicingPrinters()!);
        const raw=response as {errors?:unknown;warnings?:unknown;voidedTickets?:unknown;refundedTickets?:unknown};
        const reportedDocuments=kind==='VOID'?raw?.voidedTickets:raw?.refundedTickets;
        priorResult.airlineOperationDiagnostic={operation:kind,errors:sanitizedTicketingErrors(raw?.errors),warnings:sanitizedTicketingErrors(raw?.warnings),supplierRequestId:this.sabre!.responseReference(response),reportedDocumentCount:Array.isArray(reportedDocuments)?reportedDocuments.length:0,recordedAt:new Date().toISOString()};
        await this.db.update(flightServicingCases).set({result:priorResult,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.status,'EXECUTING')));
        const after=await this.sabre!.getBookingView(booking.pnr!);
        if(!completedTicketCancellation(response,kind,numbers)||after.bookingId!==priorResult.eligibility!.bookingId||!this.cancelledTicketEvidence(after.view,kind,numbers))throw Error('Airline cancellation outcome incomplete');
        completedView=after.view;airlineCompleted=true;
        const pending=money(quote.refundAmount)>0n;
        outcome=pending?'EXECUTING':'COMPLETED';
        message=pending?'Airline cancellation verified. Customer refund is pending; no customer money has been refunded yet.':'Airline cancellation verified. The approved quote does not require a customer money refund.';
      }else if(paidCancellation){
        await this.sabre!.cancelUnticketedBooking(booking.pnr!);
        const after=await this.sabre!.getBookingView(booking.pnr!);
        if(after.bookingId!==(priorResult.unticketedCancellation as {bookingId:string}).bookingId||!after.view.cancellationCheckComplete||after.view.flights.length||after.view.tickets.length)throw Error('Unticketed cancellation not confirmed');
        completedView=after.view;airlineCompleted=true;
        outcome=money(quote.refundAmount)>0n?'EXECUTING':'COMPLETED';
        message=outcome==='EXECUTING'?'Unticketed reservation cancellation verified. The customer refund is pending.':'Unticketed reservation cancellation verified; no customer refund is due under the approved quote.';
      }else{
        const result=record.kind==='ISSUE'?await this.ticketing.issue(booking.customerId,record.bookingId,booking.pnr!,requestId,quote.ticketing):await this.bookings.cancelUnticketed(booking.customerId,record.bookingId,booking.pnr!);
        if(record.kind==='ISSUE'&&result.status==='TICKETED'||record.kind==='CANCEL'&&result.status==='CANCELLED'){outcome='COMPLETED';message='Provider outcome verified.';}
      }
    }catch(error){
      // Both existing executors reserve CONFLICT for pre-submission checks.
      // After sending, they convert all failures to an uncertain 503 outcome.
      if(error instanceof ApiException&&error.code==='CONFLICT'&&error.getStatus()===409){outcome='FAILED';message='Rejected before airline submission: '+error.message;}
      if(error instanceof TicketingCurrencyRestrictionError){message=error.message;priorResult.ticketingDiagnostic=error.diagnostic;}
      if(error instanceof TicketingReconciliationError){message=error.message;priorResult.ticketingDiagnostic=error.diagnostic;}
      if(error instanceof TicketingPreSubmissionError){outcome='FAILED';message=error.message;priorResult.preSubmissionDiagnostic=error.diagnostic;}
      // Timeouts and every unclassified failure remain locked for reconciliation.
    }
    await this.db.transaction(async tx=>{
      if(airlineCompleted&&completedView){
        const [saved]=await tx.update(flightBookings).set({status:outcome==='COMPLETED'?'CANCELLED':'REFUND_REQUIRED',lastSabreRefreshAt:new Date(),updatedAt:new Date()}).where(and(eq(flightBookings.id,record.bookingId),eq(flightBookings.status,'MANUAL_REVIEW_REQUIRED'))).returning({id:flightBookings.id});
        if(!saved)throw conflict('The airline response needs reconciliation because the booking state changed.');
        await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot=${JSON.stringify(completedView)}::jsonb WHERE id=${record.bookingId}::uuid`);
      }
      const [executionRecord]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
      const persistedResult=(executionRecord?.result??{}) as Record<string,unknown>;
      const diagnostic=priorResult.ticketingDiagnostic as {classification?:string}|undefined;
      const stage=diagnostic?.classification==='CONFIRMATION_PENDING'?'TICKET_CONFIRMATION_PENDING':diagnostic?.classification==='DOCUMENT_RECONCILIATION_REQUIRED'?'TICKET_DOCUMENT_REVIEW':diagnostic?'MANUAL_SUPPORT_REQUIRED':airlineCompleted&&outcome==='EXECUTING'?'CUSTOMER_REFUND_PENDING':outcome==='OUTCOME_UNKNOWN'?'AIRLINE_UNKNOWN':outcome;
      const [finalized]=await tx.update(flightServicingCases).set({status:outcome,result:{...persistedResult,...priorResult,message,airlineCompleted,stage,recordedAt:new Date().toISOString()},version:sql`${flightServicingCases.version}+1`,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.status,'EXECUTING'))).returning({id:flightServicingCases.id});
      if(!finalized)return; // A concurrent read-only recovery already recorded the case outcome.
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:outcome,note:message});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.servicing.'+outcome.toLowerCase(),resourceType:'flight_servicing_case',resourceId:id,requestId});
    });return this.detail(id);
  }
  private cancelledTicketEvidence(view:FlightBookingProviderView,kind:'VOID'|'REFUND',numbers:string[]){
    return view.cancellationCheckComplete&&!view.flights.length&&view.tickets.length===numbers.length&&new Set(view.tickets.map(ticket=>ticket.number)).size===numbers.length&&view.tickets.every(ticket=>numbers.includes(ticket.number)&&(kind==='VOID'?ticket.status==='Voided':ticket.status==='Refunded/Exchanged'&&Boolean(ticket.couponStatuses?.length)&&ticket.couponStatuses!.every(status=>status==='Refunded')));
  }
  private async remainingCancellation(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
    if(!['owner','manager'].includes(staff.role))throw new ApiException('FORBIDDEN','A manager must authorize remaining-segment cancellation.',403);
    if(!(await this.capabilities()).voidExecutionAvailable)throw conflict('CERT ticket servicing is unavailable.');
    const record=await this.detail(id),booking=await this.records.booking(record.bookingId);
    type Plan={reference:string;fingerprint:string;expiresAt:string;flightIds:string[];claimedAt?:string};
    const state=(record.result??{}) as {eligibility?:AirlineEligibility;stage?:string;partialTicketOperationVerified?:boolean;airlineCompleted?:boolean;refundId?:string;remainderCancellation?:Plan;[key:string]:unknown};
    if(!['VOID','REFUND'].includes(record.kind)||record.version!==input.version||record.status!=='OUTCOME_UNKNOWN'||state.stage!=='AIRLINE_PARTIAL'||!state.partialTicketOperationVerified||state.airlineCompleted||state.refundId||state.remainderCancellation?.claimedAt||!record.approval||!record.quote||!state.eligibility||!booking.pnr||input.confirmedPnr!==booking.pnr||booking.status!=='MANUAL_REVIEW_REQUIRED')throw conflict('Only a verified partial ticket cancellation with no prior recovery claim can prepare remaining segments.');
    const context=await this.sabre!.getRemainingCancellationContext(booking.pnr,record.kind as 'VOID'|'REFUND',state.eligibility.tickets.map(ticket=>ticket.number));
    if(context.bookingId!==state.eligibility.bookingId||context.bookingId!==(booking.sabreBookingId??booking.pnr)||!booking.passengerNames.length||context.view.travellers.length!==booking.passengerNames.length||context.view.travellers.some((person,index)=>(person.givenName+' '+person.surname).trim().replace(/\s+/g,' ').toUpperCase()!==booking.passengerNames[index]!.trim().replace(/\s+/g,' ').toUpperCase())||!matchesConfirmedItinerary(context.view,booking.selectedOffer as FlightOffer))throw conflict('Remaining flights or passenger identity differ from the purchased booking. Specialist review is required.');
    const executing=input.action==='EXECUTE_REMAINING_CANCEL';
    if(executing&&(!state.remainderCancellation||Date.parse(state.remainderCancellation.expiresAt)<=Date.now()||state.remainderCancellation.fingerprint!==context.fingerprint||!input.consentReference?.trim()||input.consentReference.length>300))throw conflict('Prepare the current remaining flights and record fresh consent before manager confirmation.');
    const now=new Date().toISOString();
    const plan=executing?{...state.remainderCancellation!,claimedAt:now,approval:{staffUserId:staff.staffUserId,confirmedPnr:booking.pnr,consentReference:input.consentReference!.trim(),approvedAt:now,reference:state.remainderCancellation!.reference}}:{reference:'REMAINDER-'+context.fingerprint.slice(0,16).toUpperCase(),fingerprint:context.fingerprint,flightIds:context.flightIds,expiresAt:new Date(Date.now()+10*60000).toISOString()};
    await this.db.transaction(async tx=>{
      const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
      const [current]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
      if(!locked||locked.status!=='MANUAL_REVIEW_REQUIRED'||locked.updatedAt.toISOString()!==booking.updatedAt||!current||current.status!=='OUTCOME_UNKNOWN'||current.version!==input.version||(current.result as typeof state)?.remainderCancellation?.claimedAt)throw conflict('The booking or case changed before segment recovery.');
      const message=executing?'Remaining flight cancellation claimed once. No ticket void or refund will be repeated.':'Remaining flights verified. A manager must confirm this cancellation-only recovery; the original-payment refund remains blocked until completion.';
      await tx.update(flightServicingCases).set({status:executing?'EXECUTING':'OUTCOME_UNKNOWN',version:current.version+1,updatedAt:new Date(),result:{...state,remainderCancellation:plan,stage:executing?'REMAINDER_CANCELLING':'AIRLINE_PARTIAL',message}}).where(eq(flightServicingCases.id,id));
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:executing?'REMAINDER_CANCEL_CLAIMED':'REMAINDER_CANCEL_PREPARED',note:JSON.stringify({reference:plan.reference,flightIds:plan.flightIds,...(executing?{consentReference:input.consentReference}:{}),ticketOperationRepeated:false})});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:executing?'flight.remainder_cancel.claimed':'flight.remainder_cancel.prepared',resourceType:'flight_servicing_case',resourceId:id,requestId});
    });
    if(!executing)return this.detail(id);
    let responseReceived=false;
    try{await this.sabre!.cancelRemainingFlightSegments(booking.pnr,context.flightIds);responseReceived=true;}catch{/* Uncertain dispatch is reconciled read-only, never sent again. */}
    await this.db.transaction(async tx=>{
      const [current]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
      if(current?.status!=='EXECUTING'||(current.result as {stage?:string})?.stage!=='REMAINDER_CANCELLING')return;
      await tx.update(flightServicingCases).set({status:'OUTCOME_UNKNOWN',version:current.version+1,updatedAt:new Date(),result:{...current.result as object,stage:'REMAINDER_CANCEL_CHECK',message:'Verify remaining-flight cancellation before customer refund. This recovery cannot be submitted again.',remainderResponseReceived:responseReceived}}).where(eq(flightServicingCases.id,id));
    });
    const latest=await this.detail(id);
    try{return await this.reconcile(id,{action:'RECONCILE',version:latest.version,confirmedPnr:booking.pnr},staff,requestId);}catch{return this.detail(id);}
  }
  private async recordSupportEvidence(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
    if(!['owner','manager'].includes(staff.role))throw new ApiException('FORBIDDEN','An owner or manager must attest authenticated support evidence.',403);
    let evidence:SupportReconciliationEvidence;try{evidence=supportReconciliationEvidence(input.supportEvidence);}catch(error){throw invalid((error as Error).message);}
    const record=await this.detail(id),booking=await this.records.booking(record.bookingId);
    if(record.kind!=='ISSUE'||record.status!=='OUTCOME_UNKNOWN'||record.version!==input.version||evidence.confirmedPnr!==booking.pnr||evidence.confirmedPcc!==this.config.SABRE_PCC)throw conflict('Support evidence must match this locked case, PNR and configured PCC.');
    const attestation={...evidence,authenticatedByStaff:staff.staffUserId,recordedAt:new Date().toISOString(),sourceVerification:'OPERATOR_ATTESTATION',automaticallyVerified:false};
    await this.db.transaction(async tx=>{
      const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
      if(!locked||locked.pnrLocator!==evidence.confirmedPnr||locked.updatedAt.toISOString()!==booking.updatedAt)throw conflict('The booking changed while recording support evidence.');
      const [changed]=await tx.update(flightServicingCases).set({result:{...(record.result as Record<string,unknown>??{}),supportEvidence:attestation},version:record.version+1,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.status,'OUTCOME_UNKNOWN'),eq(flightServicingCases.version,input.version))).returning({id:flightServicingCases.id});
      if(!changed)throw conflict('The case changed while recording evidence.');
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'SUPPORT_EVIDENCE_RECORDED',note:JSON.stringify(attestation)});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.ticketing.support_evidence_recorded',resourceType:'flight_servicing_case',resourceId:id,requestId});
    });return this.detail(id);
  }
  private async reconcileIssue(record:Awaited<ReturnType<AdminFlightOperationsService['detail']>>,input:OperationAction,staff:AdminIdentity,requestId:string){
    const stalled=record.status==='EXECUTING'&&record.updatedAt.getTime()<Date.now()-300000;
    if(this.config.SABRE_ENV!=='CERT'||record.version!==input.version||record.status!=='OUTCOME_UNKNOWN'&&!stalled)throw conflict('Only the current uncertain or stalled CERT case can be verified.');
    const booking=await this.records.booking(record.bookingId);
    if(!booking.pnr||input.confirmedPnr!==booking.pnr)throw invalid('Confirm the PNR before read-only verification.');
    // Enhanced issuance has always required an atomic durable dispatch claim.
    // A FINAL unknown case with no claim and an untouched paid booking stopped
    // before the mutation boundary. This is distinct from absent ticket documents.
    if(record.status==='OUTCOME_UNKNOWN'&&(record.quote as OperationQuote)?.ticketing?.ticketingApi==='ENHANCED_AIR_TICKET'){
      const notSubmitted=await this.db.transaction(async tx=>{
        const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
        const [current]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,record.id)).for('update');
        if(!locked||!current||current.version!==input.version||current.status!=='OUTCOME_UNKNOWN'||locked.updatedAt.toISOString()!==booking.updatedAt)throw conflict('The case or booking changed. Refresh before checking again.');
        const result=(current.result??{}) as Record<string,unknown>;
        if(!['AWAITING_STAFF_TICKETING','PAID'].includes(locked.status)||result.issuanceContext||result.ticketingDiagnostic||result.airlineCompleted===true)return false;
        const history=await tx.select().from(flightServicingCases).where(and(eq(flightServicingCases.bookingId,record.bookingId),eq(flightServicingCases.kind,'ISSUE')));
        if(history.some(item=>item.id!==current.id&&['APPROVED','EXECUTING','OUTCOME_UNKNOWN','COMPLETED'].includes(item.status)))return false;
        const claims=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(eq(auditEvents.actorCustomerId,locked.customerId),or(...history.map(item=>sql`${auditEvents.event} LIKE ${'flight.ticketing.dispatch-claim:'+item.id+':%'}`)))).limit(1);
        if(claims.length)return false;
        const approvals=await tx.select({id:adminAuditEvents.id}).from(adminAuditEvents).where(and(eq(adminAuditEvents.resourceId,current.id),eq(adminAuditEvents.event,'flight.servicing.execution_claimed'))).limit(1);
        if(!approvals.length)return false;
        const message='Local preflight stopped before the durable ticket dispatch claim. No airline ticket request was submitted. Review the cause, then save and approve a current quote; no automatic retry is permitted.';
        await tx.update(flightServicingCases).set({status:'FAILED',approval:null,version:current.version+1,updatedAt:new Date(),result:{...result,stage:'NOT_SUBMITTED',message,preSubmissionDiagnostic:{classification:'NOT_SUBMITTED',reason:'DISPATCH_CLAIM_NOT_CREATED',supplierMutationAttempted:false,automaticRetry:false},reconciledAt:new Date().toISOString()}}).where(eq(flightServicingCases.id,current.id));
        await tx.insert(flightServicingEvents).values({caseId:current.id,staffUserId:staff.staffUserId,event:'PREFLIGHT_RECONCILED',note:message});
        await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.ticketing.not_submitted_verified',resourceType:'flight_servicing_case',resourceId:current.id,requestId});
        return true;
      });
      if(notSubmitted)return this.detail(record.id);
    }
    const prior=(record.result??{}) as Record<string,unknown>,original=(prior.ticketingDiagnostic??{}) as Record<string,unknown>,issuance=(prior.issuanceContext??{}) as Record<string,unknown>;
    const support=prior.supportEvidence as (SupportReconciliationEvidence&{authenticatedByStaff?:string})|undefined;
    const validatingCarrier=typeof issuance.validatingAirlineCode==='string'?issuance.validatingAirlineCode:typeof original.validatingAirlineCode==='string'?original.validatingAirlineCode:support?.authenticatedByStaff&&support.channelAuthenticated?support.validatingCarrier:undefined;
    const evidence=await this.ticketing.inspectIssued({pnr:booking.pnr,bookingId:booking.sabreBookingId??booking.pnr,passengerNames:booking.passengerNames,offer:booking.selectedOffer as FlightOffer,currency:booking.currency,amount:booking.amount,pcc:this.config.SABRE_PCC??'',validatingCarrier,ticketNumbers:support?.outcome==='TICKETS_REPORTED'?support.ticketNumbers:undefined});
    const verified=evidence.verification==='VERIFIED',checkedAt=evidence.checkedAt;
    const [deliveryIntent]=verified?await this.db.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,booking.bookingIntentId)):[];
    const ticketRecipient=verified&&evidence.context?await resolveTicketEmail(deliveryIntent?.searchRequestSnapshot as Record<string,unknown>??{},evidence.context.bookingId,evidence.context.view,()=>this.sabre!.getPurchaseBooking(booking.pnr!)):undefined;
    const diagnostic={...original,operatorChecks:issuance.permissions?issuance:ticketingOperatorChecks(this.config),identitySnapshotSource:issuance.permissions?'DISPATCH_CLAIM':'CURRENT_CONFIGURATION_NOT_HISTORICAL',ticketCheck:evidence.verification,pccScope:evidence.pccScope,salesReportScope:support?.salesReportScope??'UNKNOWN',salesReportReason:support?.salesReportScope==='PCC_NOT_CONFIRMED'?'PCC_NOT_CONFIRMED':'NO_SCOPED_REPORT_ATTACHED',documentCount:evidence.documentCount,reconciliationReasons:evidence.reasons,lastCheckedAt:checkedAt,...(evidence.context?{lastSuccessfulLookupAt:checkedAt}:{}),lastCheckRequestId:requestId,lookupSupplierRequestId:evidence.supplierRequestId,automaticRetry:false,recommendedNextAction:verified?'DOCUMENTS_VERIFIED':evidence.verification==='LOOKUP_UNAVAILABLE'?'RETRY_READ_ONLY_VERIFICATION':evidence.verification==='NO_TICKETS_REPORTED'?'TRACE_EXISTING_SUPPLIER_REQUEST':'REVIEW_DOCUMENT_ASSOCIATIONS'};
    const stage=verified?'COMPLETED':original.classification==='SABRE_CURRENCY_RESTRICTION'?'MANUAL_SUPPORT_REQUIRED':evidence.verification==='NO_TICKETS_REPORTED'||evidence.verification==='LOOKUP_UNAVAILABLE'?'TICKET_CONFIRMATION_PENDING':'TICKET_DOCUMENT_REVIEW';
    const message=verified?'Ticket documents independently verified against the PNR, passengers, segments, issuing carrier, PCC and accepted fare.':evidence.verification==='NO_TICKETS_REPORTED'?'Ticket issuance not confirmed; do not retry. The latest read-only lookup reports no tickets; absence is inconclusive.':evidence.verification==='LOOKUP_UNAVAILABLE'?'Ticket issuance not confirmed; do not retry. The read-only lookup was unavailable; the original execution claim remains locked.':'Ticket issuance not confirmed; do not retry. Document identity, scope or financial evidence needs manual review.';
    await this.db.transaction(async tx=>{
      // Same intent-first serialization as the issuance and payment paths.
      const [intent]=await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,booking.bookingIntentId)).for('update');
      const [locked]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
      const [current]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,record.id)).for('update');
      if(!locked||locked.updatedAt.toISOString()!==booking.updatedAt||!current||current.version!==input.version||!['OUTCOME_UNKNOWN','EXECUTING'].includes(current.status))throw conflict('The booking or case changed during read-only reconciliation. Refresh before checking again.');
      if(!['MANUAL_REVIEW_REQUIRED','TICKETING_IN_PROGRESS','AWAITING_STAFF_TICKETING','PAID','TICKETED'].includes(locked.status))throw conflict('The current booking status needs separate manual review.');
      if(verified){
        const [payment]=await tx.select({customerId:orders.customerId,status:payments.status,provider:payments.provider,amount:payments.amount,currency:payments.currency,total:orders.totalAmount,orderCurrency:orders.currency,orderStatus:orders.status,paidAt:orders.paidAt}).from(orders).innerJoin(payments,and(eq(payments.orderId,orders.id),eq(payments.customerId,orders.customerId))).where(eq(orders.bookingIntentId,locked.bookingIntentId)).for('update').limit(1);
        if(!intent||intent.customerId!==booking.customerId||intent.currency!==booking.currency||intent.validatedTotalAmount!==booking.amount||!payment||!payment.paidAt||payment.customerId!==booking.customerId||payment.status!=='SUCCEEDED'||payment.provider!=='STRIPE_TEST'||payment.orderStatus!=='PAID'||payment.currency!==payment.orderCurrency||money(payment.amount)!==money(payment.total))throw conflict('The accepted fare or verified payment changed during document reconciliation.');
        const extras=(intent.searchRequestSnapshot as AncillarySnapshot).checkoutAncillaryPurchase;
        const pendingDocuments=extras&&['CONFIRMED','FULFILLMENT_PENDING'].includes(extras.status)&&extras.items.some(item=>item.providerAncillaryIds.length>0);
        await tx.update(orders).set({fulfillmentStatus:pendingDocuments?'NOT_STARTED':'COMPLETED',updatedAt:new Date()}).where(and(eq(orders.bookingIntentId,locked.bookingIntentId),eq(orders.status,'PAID')));
      }
      const matchingContext=evidence.context&&evidence.context.bookingId===(booking.sabreBookingId??booking.pnr);
      await tx.update(flightBookings).set({status:verified?'TICKETED':'MANUAL_REVIEW_REQUIRED',...(matchingContext?{lastSabreRefreshAt:new Date(checkedAt)}:{}),updatedAt:new Date()}).where(eq(flightBookings.id,record.bookingId));
      if(evidence.context&&matchingContext){
        await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot=${JSON.stringify(evidence.context.view)}::jsonb WHERE id=${record.bookingId}::uuid`);
        if(verified&&intent)await tx.update(flightBookingIntents).set({searchRequestSnapshot:queueTicketEmail({...intent.searchRequestSnapshot as Record<string,unknown>,...(ticketRecipient?{checkoutContactEmail:ticketRecipient}:{})},record.bookingId,evidence.context.view)}).where(eq(flightBookingIntents.id,intent.id));
      }
      await tx.update(flightServicingCases).set({status:verified?'COMPLETED':'OUTCOME_UNKNOWN',version:current.version+1,result:{...prior,ticketingDiagnostic:diagnostic,stage,message,...(verified?{reconciledAt:checkedAt}:{})},updatedAt:new Date()}).where(eq(flightServicingCases.id,record.id));
      await tx.insert(flightServicingEvents).values({caseId:record.id,staffUserId:staff.staffUserId,event:verified?'RECONCILED':'RECONCILIATION_PENDING',note:JSON.stringify({message,verification:evidence.verification,pccScope:evidence.pccScope,documentCount:evidence.documentCount,reasons:evidence.reasons,checkedAt,automaticRetry:false})});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:verified?'flight.ticketing.documents_verified':'flight.ticketing.reconciliation_pending',resourceType:'flight_servicing_case',resourceId:record.id,requestId});
      });if(verified)await this.ticketDocuments?.deliverAfterVerification(record.bookingId);return this.detail(record.id);
  }
  private async reconcile(id:string,input:OperationAction,staff:AdminIdentity,requestId:string){
    if(!['owner','manager'].includes(staff.role))throw new ApiException('FORBIDDEN','A manager must reconcile an uncertain operation.',403);
    const record=await this.detail(id);
    if(record.kind==='MODIFY')return this.modifyContact(id,input,staff,requestId,true);
    if((record.result as {airlineCompleted?:boolean}|null)?.airlineCompleted===true){const booking=await this.records.booking(record.bookingId);if(record.version!==input.version||!booking.pnr||input.confirmedPnr!==booking.pnr)throw conflict('Refresh this case and confirm the PNR before verifying the refund.');await this.customerRefunds.reconcile(id,staff,requestId);return this.detail(id);}
    if(record.kind==='EXCHANGE'){if(!this.exchanges)throw conflict('Exchange reconciliation is unavailable.');await this.exchanges.reconcile(id,input,staff);return this.detail(id);}
    if(record.kind==='ISSUE')return this.reconcileIssue(record,input,staff,requestId);
    if(this.config.SABRE_ENV!=='CERT'||!['CANCEL','VOID','REFUND'].includes(record.kind))throw conflict('This case requires specialist reconciliation.');
    const stalled=record.status==='EXECUTING'&&record.updatedAt.getTime()<Date.now()-5*60000;
    if(record.version!==input.version||record.status!=='OUTCOME_UNKNOWN'&&!stalled)throw conflict('Only uncertain outcomes or executions stalled for five minutes can be reconciled.');
    const saved=await this.records.booking(record.bookingId);
    if(!saved.pnr||input.confirmedPnr!==saved.pnr)throw invalid('Confirm the PNR before checking the airline outcome.');
    // Read-only reconciliation never repeats issuance or cancellation.
    const booking=await this.records.refresh(record.bookingId,staff,requestId);
    let evidence=booking.providerView;
    const priorResult=(record.result??{}) as {eligibility?:AirlineEligibility;unticketedCancellation?:{bookingId:string;orderId:string};[key:string]:unknown};
    let emptyItineraryProof:unknown;
    if((record.kind==='VOID'||record.kind==='REFUND')&&priorResult.eligibility&&!evidence.cancellationCheckComplete&&!evidence.flights.length&&!booking.selectedOffer.ndcContext){
      try{
        const checked=await this.sabre!.verifyTerminalEmptyItinerary(saved.pnr,priorResult.eligibility.bookingId,record.kind,priorResult.eligibility.tickets.map(ticket=>ticket.number));
        evidence=checked.view;emptyItineraryProof=checked.proof;
      }catch{throw conflict('The empty itinerary could not be independently verified. The case remains locked; no airline request was repeated.');}
    }
    const paidCancellation=record.kind==='CANCEL'&&Boolean(booking.orderId)&&priorResult.unticketedCancellation?.orderId===booking.orderId&&priorResult.unticketedCancellation?.bookingId===(booking.sabreBookingId??booking.pnr);
    const cancelled=record.kind==='CANCEL'&&evidence.cancellationCheckComplete&&!evidence.flights.length&&!evidence.tickets.length&&(!booking.orderId||paidCancellation);
    const ticketCancellation=(record.kind==='VOID'||record.kind==='REFUND')&&Boolean(priorResult.eligibility)&&this.cancelledTicketEvidence(evidence,record.kind,priorResult.eligibility!.tickets.map(ticket=>ticket.number));
    if(!cancelled&&!ticketCancellation){
      const expected=priorResult.eligibility?.tickets.map(ticket=>ticket.number)??[];
      const documentsCompleted=(record.kind==='VOID'||record.kind==='REFUND')&&expected.length>0&&evidence.tickets.length===expected.length&&evidence.tickets.every(ticket=>expected.includes(ticket.number)&&(record.kind==='VOID'?ticket.status==='Voided':ticket.status==='Refunded/Exchanged'&&!!ticket.couponStatuses?.length&&ticket.couponStatuses.every(status=>status==='Refunded')));
      if(documentsCompleted&&evidence.cancellationCheckComplete&&evidence.flights.length){
        const message='Ticket '+(record.kind==='VOID'?'void':'refund')+' verified, but flight segments remain in the reservation. The case stays locked and no customer refund is released. Specialist review is required before cancelling remaining segments.';
        await this.db.transaction(async tx=>{
          const [updated]=await tx.update(flightServicingCases).set({status:'OUTCOME_UNKNOWN',result:{...priorResult,stage:'AIRLINE_PARTIAL',message,partialTicketOperationVerified:true,remainingFlightCount:evidence.flights.length,reconciledAt:new Date().toISOString()},version:record.version+1,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,input.version),inArray(flightServicingCases.status,['OUTCOME_UNKNOWN','EXECUTING']))).returning({id:flightServicingCases.id});
          if(!updated)throw conflict('The case changed during reconciliation.');
          await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'PARTIAL_AIRLINE_OUTCOME_VERIFIED',note:message});
        });
        return this.detail(id);
      }
      throw conflict('The current airline evidence does not prove completion. The case remains locked; do not repeat the operation.');
    }
    const pendingCustomerRefund=(ticketCancellation||paidCancellation&&cancelled)&&money((record.quote as OperationQuote).refundAmount)>0n;
    await this.db.transaction(async tx=>{
      const [lockedBooking]=await tx.select().from(flightBookings).where(eq(flightBookings.id,record.bookingId)).for('update');
      const [current]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
      if(!lockedBooking||!current||current.version!==input.version||lockedBooking.updatedAt.toISOString()!==booking.updatedAt||!['OUTCOME_UNKNOWN','EXECUTING'].includes(current.status))throw conflict('The booking or case changed during reconciliation. Refresh before continuing.');
      if(!['MANUAL_REVIEW_REQUIRED','TICKETING_IN_PROGRESS','CANCELLED',...(ticketCancellation?['REFUND_REQUIRED']:[])].includes(lockedBooking.status))throw conflict('The booking status requires separate staff review.');
      if(cancelled&&!paidCancellation){
        const [order]=await tx.select({id:orders.id}).from(orders).where(eq(orders.bookingIntentId,lockedBooking.bookingIntentId)).limit(1);
        if(order)throw conflict('An order now exists. Review the payment before completing cancellation reconciliation.');
      }
      await tx.update(flightBookings).set({status:pendingCustomerRefund?'REFUND_REQUIRED':'CANCELLED',updatedAt:new Date()}).where(eq(flightBookings.id,record.bookingId));
      const message='Airline completion verified without repeating the operation.'+(pendingCustomerRefund?' The customer money refund is still pending.':'');
      if(emptyItineraryProof)await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot=${JSON.stringify(evidence)}::jsonb WHERE id=${record.bookingId}::uuid`);
      await tx.update(flightServicingCases).set({status:pendingCustomerRefund?'EXECUTING':'COMPLETED',version:current.version+1,result:{...priorResult,...(emptyItineraryProof?{emptyItineraryProof}:{}),message,airlineCompleted:ticketCancellation||paidCancellation&&cancelled,stage:pendingCustomerRefund?'CUSTOMER_REFUND_PENDING':'COMPLETED',reconciledAt:new Date().toISOString()},updatedAt:new Date()}).where(eq(flightServicingCases.id,id));
      await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'RECONCILED',note:message});
      await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.servicing.reconciled',resourceType:'flight_servicing_case',resourceId:id,requestId});
    });return this.detail(id);
  }
  async summary(){return this.db.select({status:flightBookings.status,count:sql<number>`count(*)::int`}).from(flightBookings).groupBy(flightBookings.status);}
}
