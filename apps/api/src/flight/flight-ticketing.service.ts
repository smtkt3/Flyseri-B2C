import { matchesConfirmedItinerary } from './reservation-evidence.js';
import { Inject, Injectable,Optional } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import type { AppConfig } from '@flyseri/config';
import { auditEvents, adminAuditEvents, flightServicingCases, flightBookings, flightBookingIntents, orders, payments, type DatabaseConnection } from '@flyseri/database';
import { ApiException } from '../api-exception.js';
import { APP_CONFIG, DATABASE_CONNECTION, SABRE_BOOKING_CLIENT } from '../tokens.js';
import { FlightBookingsService } from './flight-bookings.service.js';
import { SabreBookingManagementClient, SabreBookingUnknownError, SabreBookingRejectedError, type SabreTicketingProfile } from './sabre-booking-management.client.js';
import { cents, confirmedAncillaryItems, type AncillarySnapshot } from './ancillary-purchase.contract.js';
import {queueTicketEmail,resolveTicketEmail} from './ticket-document.contract.js';
import {TicketDocumentsService} from './ticket-documents.service.js';
import { randomUUID } from 'node:crypto';
import { alternateCurrencyRestriction, sanitizedTicketingErrors, TicketingValidationError } from './ticketing-currency.contract.js';
import { ticketingExecutionOptions, ticketingPaymentEvidence, sameTicketingExecution,ticketingApi, type TicketingExecutionOptions } from './ticketing-execution.contract.js';
import {FlightTicketReconciliationService} from './flight-ticket-reconciliation.service.js';
import type {TicketReconciliation,TicketReconciliationExpected} from './ticketing-reconciliation.contract.js';
import {ticketingOperatorChecks} from './ticketing-diagnostics.contract.js';
import {readRetailPricing,priceMinor} from '../pricing/flight-pricing.contract.js';

type Profile = SabreTicketingProfile;
const conflict = (message: string) => new ApiException('CONFLICT', message, 409);
export class TicketingCurrencyRestrictionError extends ApiException {
  constructor(readonly diagnostic:Record<string,unknown>){super('DEPENDENCY_UNAVAILABLE','Sabre restricted ticketing currency (code '+diagnostic.code+'). Manual Sabre PCC/stock/settlement review is required. The case remains locked; verify ticket evidence before any new approval. Do not collect another payment.',503);}
}
export class TicketingReconciliationError extends ApiException {
  constructor(readonly diagnostic:Record<string,unknown>){super('DEPENDENCY_UNAVAILABLE',diagnostic.classification==='CONFIRMATION_PENDING'?'Sabre ticket issuance remains unconfirmed. Tickets may have been issued; verify the existing booking and agency audit records before any further action.':'Issued document details need reconciliation against the approved fare and passengers. Do not issue again or collect another payment.',503);}
}
export class TicketingPreSubmissionError extends ApiException {
  constructor(readonly diagnostic:Record<string,unknown>){super('CONFLICT','Ticket preparation failed before airline submission. No ticket request was sent. Review the diagnostic and obtain a fresh approval before continuing.',409);}
}

@Injectable()
export class FlightTicketingService {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE_CONNECTION) private readonly connection: DatabaseConnection | undefined,
    @Inject(SABRE_BOOKING_CLIENT) private readonly sabre: SabreBookingManagementClient | undefined,
    @Inject(FlightBookingsService) private readonly bookings: FlightBookingsService,
    @Optional() @Inject(TicketDocumentsService) private readonly ticketDocuments?:TicketDocumentsService) {}
  inspectIssued(expected:TicketReconciliationExpected){return new FlightTicketReconciliationService(this.sabre).inspect(expected);}
  supportsEnhancedTicketing(){const profile=this.profile();return this.config.SABRE_ENV==='CERT'&&this.config.APP_ENV!=='production'&&profile?.formOfPayment==='CASH'&&/^[A-Z]{2}$/.test(profile.ticketCountryCode??'');}
  private profile(): Profile | null {
    try {
      const input = JSON.parse(this.config.SABRE_TICKETING_PROFILE ?? 'null') as Profile | null;
      if (!input || input.ticketCountryCode!==undefined&&!/^[A-Z1]{2}$/.test(input.ticketCountryCode) || !/^[A-Z0-9]{6}$/.test(input.hardcopyPrinterAddress)) return null;
      if (input.ndcAirlineCodes && (!Array.isArray(input.ndcAirlineCodes) || input.ndcAirlineCodes.length > 100 || input.ndcAirlineCodes.some(code => !/^[A-Z0-9]{2}$/.test(code)))) return null;
      const printers = { ...(input.ticketCountryCode ? {ticketCountryCode:input.ticketCountryCode} : {}), hardcopyPrinterAddress: input.hardcopyPrinterAddress, ...(input.ndcAirlineCodes ? { ndcAirlineCodes: [...input.ndcAirlineCodes] } : {}) };
      if(input.formOfPayment==='CASH'&&this.config.SABRE_ENV==='CERT'&&this.config.APP_ENV!=='production')return {...printers,formOfPayment:'CASH'};
      if (input.formOfPayment === 'INVOICE' && typeof input.invoiceDescription === 'string' && input.invoiceDescription.trim() && input.invoiceDescription.length <= 120)
        return { ...printers, formOfPayment: input.formOfPayment, invoiceDescription: input.invoiceDescription };
      if (input.formOfPayment === 'PAYMENTCARD' && /^[A-Z]{2}$/.test(input.cardTypeCode) && /^\d{13,19}$/.test(input.cardNumber) && /^\d{3,4}$/.test(input.cardSecurityCode) &&
        /^\d{4}-(0[1-9]|1[0-2])$/.test(input.expiryDate) && input.expiryDate >= new Date().toISOString().slice(0, 7) &&
        (input.manualApprovalCode === undefined || /^[A-Z0-9]{1,12}$/.test(input.manualApprovalCode)))
        {
          if (input.cardHolder && (!input.cardHolder.address || !['givenName', 'surname'].every(key => typeof input.cardHolder![key as 'givenName' | 'surname'] === 'string' && input.cardHolder![key as 'givenName' | 'surname'].trim().length > 0) || !['name', 'street', 'city', 'stateProvince', 'postalCode', 'countryCode'].every(key => typeof input.cardHolder!.address[key as keyof typeof input.cardHolder.address] === 'string' && input.cardHolder!.address[key as keyof typeof input.cardHolder.address].length > 0) || !/^[A-Z]{2}$/.test(input.cardHolder.address.countryCode))) return null;
          if (input.authentications && (!Array.isArray(input.authentications) || input.authentications.length !== 1 || input.authentications[0]?.channelCode !== 'MO')) return null;
          return { ...printers, formOfPayment: input.formOfPayment, cardTypeCode: input.cardTypeCode, cardNumber: input.cardNumber,
          cardSecurityCode: input.cardSecurityCode, expiryDate: input.expiryDate, ...(input.manualApprovalCode ? { manualApprovalCode: input.manualApprovalCode } : {}), ...(input.cardHolder ? { cardHolder: { givenName: input.cardHolder.givenName, surname: input.cardHolder.surname, address: { name: input.cardHolder.address.name, street: input.cardHolder.address.street, city: input.cardHolder.address.city, stateProvince: input.cardHolder.address.stateProvince, postalCode: input.cardHolder.address.postalCode, countryCode: input.cardHolder.address.countryCode } } } : {}), ...(input.authentications ? { authentications: [{ channelCode: 'MO' as const }] } : {}) };
        }
      return null;
    } catch { return null; }
  }
  async capabilities() {
    let evidenceReady = false;
    if (this.config.FLIGHT_TICKETING_EXECUTION_ENABLED === 'true' && this.profile() && this.connection && this.sabre) {
      try {
        const evidence = await this.connection.pool.query("SELECT count(*)::int AS count FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'flight_bookings' AND column_name IN ('booked_passenger_names','provider_view_snapshot')");
        const constraint = await this.connection.pool.query("SELECT pg_get_constraintdef(oid) AS definition FROM pg_constraint WHERE conrelid = 'public.orders'::regclass AND conname = 'orders_fulfillment_valid'");
        evidenceReady = evidence.rows[0]?.count === 2 && constraint.rows[0]?.definition?.includes('COMPLETED');
      } catch { /* Keep issuance disabled if evidence storage is unavailable. */ }
    }
    return { ticketIssuanceAvailable: evidenceReady,
    // This workflow requires the authenticated admin case and its durable claim.
    automaticTicketingEnabled:false,
    customerTicketingEnabled:false,
    environment: this.config.SABRE_ENV, ticketingMessage: evidenceReady?'CERT staff ticket issuance is configured. A verified Stripe test payment and approved servicing case are required.':'CERT ticketing requires a confirmed Stripe sandbox payment and configured Sabre payment/printer details.' }; }
  canFulfillNdc(airlines: string[]) {
    const profile = this.profile();
    return !!profile?.ndcAirlineCodes?.length && airlines.length > 0 && airlines.every(code => profile.ndcAirlineCodes!.includes(code)) &&
      (profile.formOfPayment === 'INVOICE' || profile.formOfPayment==='PAYMENTCARD'&&!!profile.cardHolder && !!profile.authentications?.length);
  }
  servicingPrinters(){const address=this.config.SABRE_SERVICING_PRINTER??this.profile()?.hardcopyPrinterAddress;return address&&/^[A-Z0-9]{6}$/.test(address)?[{hardcopy:{address}}]:null;}
  ancillarySettlementProfile(){return this.config.SABRE_ENV==='CERT'&&this.config.APP_ENV!=='production'?this.profile():null;}
  async reissue(pnr:string,pqrs:import('./flight-exchange-execution.contract.js').ExchangePqr[],privateTravelerNames:string[]=[]){
    const profile=this.profile();
    if(!(await this.capabilities()).ticketIssuanceAvailable||!profile||profile.formOfPayment!=='CASH'||!this.sabre)throw conflict('CERT reissue requires the configured CASH ticketing profile.');
    return this.sabre.fulfillExchange(pnr,pqrs,profile,privateTravelerNames);
  }
  async issue(customerId: string, id: string, confirmedPnr: string,correlationId:string=randomUUID(),execution?:TicketingExecutionOptions) {
    const progress={claimed:false};
    try{return await this.issueOnce(customerId,id,confirmedPnr,correlationId,execution,progress);}
    catch(error){
      if(progress.claimed||error instanceof ApiException)throw error;
      const causes:unknown[]=[];let cause:unknown=error;
      for(let depth=0;depth<5&&cause&&typeof cause==='object';depth++){causes.push(cause);cause=(cause as {cause?:unknown}).cause;}
      const databaseCode=causes.map(value=>(value as {code?:unknown}).code).find(value=>typeof value==='string'&&/^[0-9A-Z]{5}$/.test(value));
      throw new TicketingPreSubmissionError({classification:'NOT_SUBMITTED',phase:'PREFLIGHT',reason:'LOCAL_PREFLIGHT_FAILED',...(databaseCode?{databaseCode}:{}),recordedAt:new Date().toISOString(),supplierMutationAttempted:false,automaticRetry:false});
    }
  }
  private async issueOnce(customerId:string,id:string,confirmedPnr:string,correlationId:string,execution:TicketingExecutionOptions|undefined,progress:{claimed:boolean}) {
    const options=ticketingExecutionOptions(execution);
    const enhanced=ticketingApi(options)==='ENHANCED_AIR_TICKET';
    const operation=enhanced?'enhancedAirTicket':'fulfillFlightTickets',endpoint=enhanced?'/v1.3.0/air/ticket':'/v1/trip/orders/fulfillFlightTickets';
    const profile = this.profile();
    if (!(await this.capabilities()).ticketIssuanceAvailable || !profile || !this.connection || !this.sabre) throw new ApiException('DEPENDENCY_UNAVAILABLE', 'Test ticket issuance is awaiting Sabre settlement configuration and evidence storage. Your payment and reservation are kept.', 503);
    const booking = await this.bookings.detail(customerId, id);
    if(enhanced&&(booking.selectedOffer.ndcContext||profile.formOfPayment!=='CASH'||!/^[A-Z]{2}$/.test(profile.ticketCountryCode??'')))throw conflict('Enhanced Air Ticket requires an ATPCO booking and approved CERT CASH/printer profile with ticket country.');
    if (!booking.pnr || booking.pnr !== confirmedPnr) throw conflict('Confirm this reservation before ticketing.');
    if (booking.selectedOffer.ndcContext && !this.canFulfillNdc(booking.selectedOffer.airlineCodes)) throw conflict('This airline requires an approved NDC settlement profile before ticketing.');
    if (booking.passengerNamesSource !== 'BOOKED_SNAPSHOT') throw conflict('This legacy reservation needs staff passenger reconciliation before ticketing.');
    if (booking.status === 'TICKETED') return booking;
    if (!['AWAITING_STAFF_TICKETING', 'PAID'].includes(booking.status)) throw conflict('This reservation is not ready for ticket issuance.');
    // A service/worker/customer call cannot bypass the normal approved admin claim.
    const [dispatchCase]=await this.connection.db.select({record:flightServicingCases}).from(flightServicingCases).innerJoin(adminAuditEvents,and(eq(adminAuditEvents.resourceId,flightServicingCases.id),eq(adminAuditEvents.event,'flight.servicing.execution_claimed'),eq(adminAuditEvents.requestId,correlationId))).where(and(eq(flightServicingCases.bookingId,id),eq(flightServicingCases.kind,'ISSUE'),eq(flightServicingCases.status,'EXECUTING'))).limit(1);
    const casePolicy=(dispatchCase?.record.quote as {ticketing?:TicketingExecutionOptions}|null)?.ticketing;
    const caseApproval=dispatchCase?.record.approval as {pnr?:string;ticketing?:TicketingExecutionOptions}|null;
    if(!dispatchCase||caseApproval?.pnr!==confirmedPnr||!sameTicketingExecution(casePolicy,options)||!sameTicketingExecution(caseApproval.ticketing,options))throw conflict('Ticket issuance requires the exact approved and claimed normal admin case.');
    let context:Awaited<ReturnType<SabreBookingManagementClient['getTicketingContext']>>|null;
    try{context=booking.selectedOffer.ndcContext?null:await this.sabre.getTicketingContext(booking.pnr,options);}
    catch(error){
      if(error instanceof TicketingValidationError){
        await this.connection.db.insert(auditEvents).values({actorCustomerId:customerId,tripId:booking.tripId,event:'flight.ticketing.preflight:'+id+':'+JSON.stringify({classification:'LOCAL_VALIDATION',code:error.code,operation:'getBooking',environment:this.config.SABRE_ENV,configuredPcc:this.config.SABRE_PCC,correlationId})});
        throw conflict(error.message);
      }throw error;
    }
    const current=context??await this.sabre.getBookingView(booking.pnr);
    const [storedIntent] = await this.connection.db.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, booking.bookingIntentId), eq(flightBookingIntents.customerId, customerId))).limit(1);
    const extraSnapshot = storedIntent!.searchRequestSnapshot as AncillarySnapshot;
    const ticketRecipient=await resolveTicketEmail(extraSnapshot,current.bookingId,current.view,()=>this.sabre!.getPurchaseBooking(booking.pnr!));
    if(context&&(context.selection.currency!==storedIntent!.currency||!storedIntent!.validatedTotalAmount||cents(context.selection.totalAmount)!==cents(storedIntent!.validatedTotalAmount)))throw conflict('The current stored airline fare differs from the accepted fare. Reconcile pricing before issuance.');
    const extraPurchase = extraSnapshot.checkoutAncillaryPurchase;
    if (extraSnapshot.checkoutAncillaryRequests?.length && (!extraPurchase || !['CONFIRMED', 'SKIPPED'].includes(extraPurchase.status))) throw conflict('Review airline extras before ticket issuance.');
    const ancillaryIds = extraPurchase?.status === 'CONFIRMED' ? extraPurchase.items.flatMap(item => item.providerAncillaryIds) : [];
    if (extraPurchase?.status === 'CONFIRMED') {
      const evidence = confirmedAncillaryItems(await this.sabre.getPurchaseBooking(booking.pnr), extraPurchase.plans, extraSnapshot.checkoutAncillaryRequests ?? []);
      if (!ancillaryIds.length || new Set(ancillaryIds).size !== ancillaryIds.length || evidence.some(item => !extraPurchase.items.some(expected => expected.requestId === item.requestId && expected.providerAncillaryIds.includes(item.itemId) && expected.airlineCurrency === item.currency && cents(expected.airlineAmount) === cents(item.amount)))) throw conflict('The confirmed airline extra price or association changed. Contact Flyseri before issuance.');
    }
    if (!current.view.cancellationCheckComplete || current.view.tickets.length || current.view.travellers.length !== booking.passengerNames.length || current.view.travellers.some((person,index)=>[person.givenName,person.surname].join(' ').trim().replace(/\s+/g,' ').toUpperCase() !== booking.passengerNames[index]!.trim().replace(/\s+/g,' ').toUpperCase()) || !matchesConfirmedItinerary(current.view, booking.selectedOffer)) throw conflict('The current PNR needs staff review before ticketing.');
    const db = this.connection.db;
    const customerPaymentCurrency=await db.transaction(async tx => {
      // Fail a blocked local claim promptly; never keep an operator waiting on a row lock.
      await tx.execute(sql`SET LOCAL lock_timeout = '5s'`);
      await tx.execute(sql`SET LOCAL statement_timeout = '15s'`);
      const [lockedIntent] = await tx.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id, booking.bookingIntentId), eq(flightBookingIntents.customerId, customerId))).for('update');
      const lockedExtras = (lockedIntent!.searchRequestSnapshot as AncillarySnapshot).checkoutAncillaryPurchase;
      if (JSON.stringify(lockedExtras) !== JSON.stringify(extraPurchase)) throw conflict('The airline extras changed during issuance preparation.');
      const [order] = await tx.select().from(orders).where(and(eq(orders.customerId, customerId), eq(orders.bookingIntentId, booking.bookingIntentId))).for('update').limit(1);
      if (!order || order.status !== 'PAID' || !order.paidAt || order.fulfillmentStatus === 'REVALIDATION_REQUIRED') throw conflict('A confirmed eligible order payment is required before ticketing.');
      const retail=readRetailPricing((lockedIntent!.searchRequestSnapshot as {retailPricing?:unknown}).retailPricing,lockedIntent!.validatedTotalAmount!,lockedIntent!.currency);
      const expectedSubtotal=priceMinor(retail?.sellingTotal??lockedIntent!.validatedTotalAmount!)+(extraPurchase?.status==='CONFIRMED'?cents(extraPurchase.extrasAmount):0n);
      if(order.currency!==lockedIntent!.currency||priceMinor(order.subtotalAmount)!==expectedSubtotal||priceMinor(order.totalAmount)+priceMinor(order.discountAmount)!==expectedSubtotal)throw conflict('The paid order does not match the frozen client price and verified airline extras.');
      const [payment] = await tx.select().from(payments).where(and(eq(payments.orderId, order.id), eq(payments.customerId, customerId))).limit(1);
      if (!payment || payment.status !== 'SUCCEEDED' || payment.provider !== 'STRIPE_TEST' || payment.amount !== order.totalAmount || payment.currency !== order.currency) throw conflict('The sandbox payment evidence does not match the order.');
      const [row] = await tx.select().from(flightBookings).where(and(eq(flightBookings.id, id), eq(flightBookings.customerId, customerId))).for('update').limit(1);
      if (!row || !['AWAITING_STAFF_TICKETING', 'PAID'].includes(row.status) || row.pnrLocator !== confirmedPnr || row.sabreBookingId && row.sabreBookingId !== current.bookingId) throw conflict('This booking changed or already has a ticketing attempt.');
      const [lockedCase]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,dispatchCase.record.id)).for('update');
      if(!lockedCase||lockedCase.status!=='EXECUTING'||lockedCase.version!==dispatchCase.record.version)throw conflict('The approved admin execution claim changed.');
      const claimPrefix='flight.ticketing.dispatch-claim:'+lockedCase.id+':'+lockedCase.version+':';
      const previousClaim=await tx.select({id:auditEvents.id}).from(auditEvents).where(and(eq(auditEvents.actorCustomerId,customerId),sql`${auditEvents.event} LIKE ${claimPrefix+'%'}`)).limit(1);
      if(previousClaim.length)throw conflict('This approved ticket dispatch was already claimed. Reconcile the original attempt.');
      const issuanceContext={...ticketingOperatorChecks(this.config),environment:this.config.SABRE_ENV,execution:options,validatingAirlineCode:context?.selection.validatingAirlineCode,priceQuoteRecordIds:context?.selection.priceQuoteRecordIds??[],currency:storedIntent!.currency,amount:storedIntent!.validatedTotalAmount,correlationId,claimedAt:new Date().toISOString(),automaticRetry:false};
      await tx.insert(auditEvents).values({actorCustomerId:customerId,tripId:booking.tripId,event:claimPrefix+JSON.stringify(issuanceContext)});
      await tx.update(flightServicingCases).set({result:{...(lockedCase.result as Record<string,unknown>??{}),issuanceContext}}).where(eq(flightServicingCases.id,lockedCase.id));
      await tx.update(flightBookings).set({ status: 'TICKETING_IN_PROGRESS', updatedAt: new Date() }).where(eq(flightBookings.id, id));
      await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: booking.tripId, event: 'flight.ticketing.claimed' });
      return order.currency;
    });
    progress.claimed=true;
    let observed:Awaited<ReturnType<SabreBookingManagementClient['getBookingView']>>|undefined;
    let recoveryVerification:TicketReconciliation|undefined;
    let fulfillmentFailure:SabreBookingUnknownError|undefined;
    try {
      let fulfillment:unknown;
      try{
        fulfillment=enhanced?await this.sabre.issueEnhancedAirTicket(confirmedPnr,profile,{priceQuoteRecordIds:context!.selection.priceQuoteRecordIds,validatingAirlineCode:context!.selection.validatingAirlineCode},options,booking.passengerNames.flatMap(name=>[name,...name.split(' ')])):await this.sabre.fulfillFlightTickets(confirmedPnr, profile, ancillaryIds, !!booking.selectedOffer.ndcContext,context?{priceQuoteRecordIds:context.selection.priceQuoteRecordIds,validatingAirlineCode:context.selection.validatingAirlineCode}:undefined,options);
      }catch(error){
        if(!(error instanceof SabreBookingUnknownError)||!enhanced&&!sanitizedTicketingErrors([...(error.diagnostic?.errors??[]),...(error.diagnostic?.warnings??[])]).some(item=>item.type==='UNABLE_TO_RETRIEVE_TICKETS'))throw error;
        // The dispatch has already happened. Recover through Get Booking only.
        fulfillmentFailure=error;
      }
      const returnedTickets=(fulfillment as {tickets?:{number:string}[]}|undefined)?.tickets??[];
      const expected={pnr:confirmedPnr,bookingId:current.bookingId,passengerNames:booking.passengerNames,offer:booking.selectedOffer,currency:storedIntent!.currency,amount:storedIntent!.validatedTotalAmount!,pcc:this.config.SABRE_PCC??'',validatingCarrier:context?.selection.validatingAirlineCode,...(!fulfillmentFailure&&!ancillaryIds.length?{ticketNumbers:returnedTickets.map(ticket=>ticket.number)}:{})};
      const verification=fulfillmentFailure?await new FlightTicketReconciliationService(this.sabre).recover(expected):await this.inspectIssued(expected);
      if(fulfillmentFailure)recoveryVerification=verification;
      if(verification.context)observed={bookingId:verification.context.bookingId,view:verification.context.view};
      // Preserve the original dispatch/request/warning evidence when lookup cannot recover it.
      if(verification.verification!=='VERIFIED'&&fulfillmentFailure)throw fulfillmentFailure;
      if(verification.verification!=='VERIFIED')throw new TicketingReconciliationError({classification:'DOCUMENT_RECONCILIATION_REQUIRED',reason:'DOCUMENT_EVIDENCE_NOT_VERIFIED',ticketCheck:verification.verification,reconciliationReasons:verification.reasons,pccScope:verification.pccScope,documentCount:verification.documentCount,lastCheckedAt:verification.checkedAt,correlationId,supplierRequestId:this.sabre.responseReference?.(fulfillment),dispatch:this.sabre.dispatchReference?.(fulfillment),automaticRetry:false});
      const result=verification.context!;
      // Recovered Get Booking documents have already passed the independent amount,
      // currency, passenger, segment, carrier and issuing PCC verification above.
      if(!fulfillmentFailure&&!ticketingPaymentEvidence(fulfillment,{currency:storedIntent!.currency,amount:storedIntent!.validatedTotalAmount!,ticketNumbers:result.view.tickets.map(ticket=>ticket.number)}))throw new TicketingReconciliationError({classification:'DOCUMENT_RECONCILIATION_REQUIRED',reason:'ISSUED_DOCUMENT_AMOUNT_UNVERIFIED',documentCount:verification.documentCount,correlationId,supplierRequestId:this.sabre.responseReference?.(fulfillment),dispatch:this.sabre.dispatchReference?.(fulfillment),automaticRetry:false});
      const recoverySummary=fulfillmentFailure?{...verification.recovery,verification:verification.verification,checkedAt:verification.checkedAt,lookupSupplierRequestId:verification.supplierRequestId,originalSupplierRequestId:fulfillmentFailure.diagnostic?.supplierRequestId,dispatch:fulfillmentFailure.diagnostic?.dispatch,errors:sanitizedTicketingErrors(fulfillmentFailure.diagnostic?.errors),warnings:sanitizedTicketingErrors(fulfillmentFailure.diagnostic?.warnings),automaticRetry:false}:undefined;
      await db.transaction(async tx => {
        const [intent] = await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id, booking.bookingIntentId)).for('update');
        if(!intent||intent.currency!==storedIntent!.currency||intent.validatedTotalAmount!==storedIntent!.validatedTotalAmount||JSON.stringify((intent.searchRequestSnapshot as {retailPricing?:unknown}).retailPricing)!==JSON.stringify((storedIntent!.searchRequestSnapshot as {retailPricing?:unknown}).retailPricing))throw new Error('Accepted fare or retail snapshot changed during ticket verification');
        const [order]=await tx.select().from(orders).where(and(eq(orders.bookingIntentId,booking.bookingIntentId),eq(orders.customerId,customerId))).for('update').limit(1);
        const [payment]=order?await tx.select().from(payments).where(and(eq(payments.orderId,order.id),eq(payments.customerId,customerId))).for('update').limit(1):[];
        if(!order||order.status!=='PAID'||!order.paidAt||order.fulfillmentStatus==='REVALIDATION_REQUIRED'||!payment||payment.status!=='SUCCEEDED'||payment.provider!=='STRIPE_TEST'||payment.amount!==order.totalAmount||payment.currency!==order.currency)throw new Error('Verified payment changed during ticket verification');
        const [saved] = await tx.update(flightBookings).set({ status: 'TICKETED', lastSabreRefreshAt: new Date(), updatedAt: new Date() })
          .where(and(eq(flightBookings.id, id), eq(flightBookings.status, 'TICKETING_IN_PROGRESS'))).returning({ id: flightBookings.id });
        if (!saved) throw new Error('Ticketing claim changed');
        await tx.execute(sql`UPDATE flight_bookings SET provider_view_snapshot = ${JSON.stringify(result.view)}::jsonb WHERE id = ${id}::uuid`);
        if (ancillaryIds.length) {
          const snapshot = intent!.searchRequestSnapshot as AncillarySnapshot;
          await tx.update(flightBookingIntents).set({ searchRequestSnapshot: { ...snapshot, checkoutAncillaryPurchase: { ...extraPurchase!, status: 'FULFILLMENT_PENDING',documentAttempt:{status:enhanced?'NOT_STARTED':'CLAIMED'}, message: enhanced?'Flight tickets were verified. Staff must separately confirm extra-service document issuance.':'Flight tickets were verified. Extra-service document issuance was requested and needs document reconciliation before completion.' } }, updatedAt: new Date() }).where(eq(flightBookingIntents.id, booking.bookingIntentId));
        }
        await tx.update(orders).set({ fulfillmentStatus: ancillaryIds.length ? 'NOT_STARTED' : 'COMPLETED', updatedAt: new Date() }).where(and(eq(orders.bookingIntentId, booking.bookingIntentId), eq(orders.customerId, customerId), eq(orders.status, 'PAID')));
        const [deliveryIntent]=await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,booking.bookingIntentId));
        await tx.update(flightBookingIntents).set({searchRequestSnapshot:queueTicketEmail({...deliveryIntent!.searchRequestSnapshot as Record<string,unknown>,...(ticketRecipient?{checkoutContactEmail:ticketRecipient}:{})},id,result.view)}).where(eq(flightBookingIntents.id,booking.bookingIntentId));
        await tx.insert(auditEvents).values({ actorCustomerId: customerId, tripId: booking.tripId, event: 'flight.ticketing.verified' });
        if(recoverySummary){
          const [lockedCase]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,dispatchCase.record.id)).for('update');
          if(!lockedCase||lockedCase.status!=='EXECUTING'||lockedCase.version!==dispatchCase.record.version)throw new Error('Ticket recovery claim changed');
          await tx.update(flightServicingCases).set({result:{...(lockedCase.result as Record<string,unknown>??{}),ticketRecovery:recoverySummary}}).where(eq(flightServicingCases.id,lockedCase.id));
        }
        await tx.insert(auditEvents).values({actorCustomerId:customerId,tripId:booking.tripId,event:'flight.ticketing.confirmed:'+id+':'+JSON.stringify({...ticketingOperatorChecks(this.config),operation,endpoint,environment:this.config.SABRE_ENV,configuredPcc:this.config.SABRE_PCC,correlationId,dispatch:this.sabre!.dispatchReference?.(fulfillment)??fulfillmentFailure?.diagnostic?.dispatch,supplierRequestId:this.sabre!.responseReference?.(fulfillment)??fulfillmentFailure?.diagnostic?.supplierRequestId,execution:options,priceQuoteRecordIds:context?.selection.priceQuoteRecordIds??[],currency:storedIntent!.currency,amount:storedIntent!.validatedTotalAmount,documentCount:result.view.tickets.length,...(recoverySummary?{ticketRecovery:recoverySummary}:{})})});
      });
    } catch(error) {
      // Every result after sending is potentially a successful airline mutation.
      // A failure must never enable an automatic second issuance attempt.
      await db.update(flightBookings).set({ status: 'MANUAL_REVIEW_REQUIRED', updatedAt: new Date() })
        .where(and(eq(flightBookings.id, id), eq(flightBookings.status, 'TICKETING_IN_PROGRESS')));
      if(observed?.bookingId===current.bookingId)await db.execute(sql`UPDATE flight_bookings SET provider_view_snapshot=${JSON.stringify(observed.view)}::jsonb,last_sabre_refresh_at=now() WHERE id=${id}::uuid AND customer_id=${customerId}::uuid`);
      const originalError=fulfillmentFailure??error;
      const supplierRequestId=originalError instanceof SabreBookingUnknownError?originalError.diagnostic?.supplierRequestId:originalError instanceof SabreBookingRejectedError?originalError.supplierRequestId:undefined;
      const warnings=originalError instanceof SabreBookingUnknownError?sanitizedTicketingErrors(originalError.diagnostic?.warnings):[];
      const failure={...ticketingOperatorChecks(this.config),recordedAt:new Date().toISOString(),validatingAirlineCode:context?.selection.validatingAirlineCode,dispatch:error instanceof SabreBookingUnknownError?error.diagnostic?.dispatch:error instanceof SabreBookingRejectedError?error.dispatch:undefined,documentCount:error instanceof SabreBookingUnknownError?error.diagnostic?.dispatch?.documentCount??0:observed?.view.tickets.length??0,operation,endpoint,priceQuoteRecordIds:context?.selection.priceQuoteRecordIds??[],payableCurrency:context?.selection.currency,customerPaymentCurrency,environment:this.config.SABRE_ENV,configuredPcc:this.config.SABRE_PCC,correlationId,supplierRequestId,execution:options,automaticRetry:false,...(error instanceof SabreBookingUnknownError?{reason:error.reason,transportFailure:error.diagnostic?.transportFailure,httpStatus:error.httpStatus,errors:sanitizedTicketingErrors(error.diagnostic?.errors),warnings,responseKeys:error.diagnostic?.responseKeys}:error instanceof SabreBookingRejectedError?{reason:'PROVIDER_REJECTED',httpStatus:error.httpStatus,errors:sanitizedTicketingErrors(error.diagnostics)}:error instanceof TicketingReconciliationError?error.diagnostic:{reason:'DOCUMENT_EVIDENCE_NOT_VERIFIED'})};
      if(fulfillmentFailure)Object.assign(failure,{supplierRequestId:fulfillmentFailure.diagnostic?.supplierRequestId,dispatch:fulfillmentFailure.diagnostic?.dispatch,reason:recoveryVerification?.verification==='VERIFIED'?'RECOVERED_DOCUMENTS_NOT_COMMITTED':fulfillmentFailure.reason,httpStatus:fulfillmentFailure.httpStatus,errors:sanitizedTicketingErrors(fulfillmentFailure.diagnostic?.errors),warnings,responseKeys:fulfillmentFailure.diagnostic?.responseKeys});
      if(recoveryVerification)Object.assign(failure,{ticketCheck:recoveryVerification.verification,pccScope:recoveryVerification.pccScope,documentCount:recoveryVerification.documentCount,reconciliationReasons:recoveryVerification.reasons,lastCheckedAt:recoveryVerification.checkedAt,lookupSupplierRequestId:recoveryVerification.supplierRequestId,recovery:recoveryVerification.recovery});
      await db.insert(auditEvents).values({actorCustomerId:customerId,tripId:booking.tripId,event:'flight.ticketing.diagnostic:'+id+':'+JSON.stringify(failure)});
      const restriction=alternateCurrencyRestriction(error instanceof SabreBookingUnknownError?[...(error.diagnostic?.errors??[]),...(error.diagnostic?.warnings??[])]:error instanceof SabreBookingRejectedError?error.diagnostics:[]);
      if(restriction){
        let ticketCheck='UNAVAILABLE';
        try{const checked=await this.sabre.getBookingView(confirmedPnr);ticketCheck=checked.bookingId!==current.bookingId||!checked.view.cancellationCheckComplete?'INCOMPLETE':checked.view.tickets.length?'TICKETS_PRESENT_RECONCILIATION_REQUIRED':'NO_TICKETS_REPORTED';}catch{/* Unavailable lookup never enables a retry. */}
        const diagnostic={...failure,...restriction,operation,endpoint,environment:this.config.SABRE_ENV,configuredPcc:this.config.SABRE_PCC,...context?.currencyEvidence,priceQuoteRecordIds:context?.selection.priceQuoteRecordIds??[],payableCurrency:context?.selection.currency,customerPaymentCurrency,correlationId,supplierRequestId,ticketCheck,automaticRetry:false};
        await db.insert(auditEvents).values({actorCustomerId:customerId,tripId:booking.tripId,event:'flight.ticketing.currency-restriction:'+id+':'+JSON.stringify(diagnostic)});
        throw new TicketingCurrencyRestrictionError(diagnostic);
      }
      if(warnings.some(warning=>warning.type==='UNABLE_TO_RETRIEVE_TICKETS')||recoveryVerification)throw new TicketingReconciliationError({...failure,classification:recoveryVerification&&['VERIFIED','IDENTITY_MISMATCH','DOCUMENTS_INCOMPLETE'].includes(recoveryVerification.verification)?'DOCUMENT_RECONCILIATION_REQUIRED':'CONFIRMATION_PENDING'});
      if(error instanceof TicketingReconciliationError)throw new TicketingReconciliationError(failure);
      throw new TicketingReconciliationError({...failure,classification:'CONFIRMATION_PENDING'});
    }
    await this.ticketDocuments?.deliverAfterVerification(id);
    return this.bookings.detail(customerId, id);
  }
}
