import {Inject,Injectable} from '@nestjs/common';
import {createHash} from 'node:crypto';
import {and,eq} from 'drizzle-orm';
import {flightBookings,flightBookingIntents,flightServicingCases,flightServicingEvents,adminAuditEvents,orders,payments,type DatabaseConnection} from '@flyseri/database';
import type {AppConfig} from '@flyseri/config';
import {APP_CONFIG,DATABASE_CONNECTION,SABRE_BOOKING_CLIENT} from '../tokens.js';
import {ApiException} from '../api-exception.js';
import {SabreBookingManagementClient,SabreBookingUnknownError,SabreBookingRejectedError} from '../flight/sabre-booking-management.client.js';
import {FlightTicketingService} from '../flight/flight-ticketing.service.js';
import type {AncillarySnapshot,StoredAncillaryPurchase,AncillaryDocumentApi,AncillaryDocumentDiagnostic} from '../flight/ancillary-purchase.contract.js';
import {sanitizedTicketingErrors} from '../flight/ticketing-currency.contract.js';
import {buildEnhancedAirExtras} from '../flight/enhanced-air-ticket.contract.js';
import {AdminFlightRefundsService} from './admin-flight-refunds.service.js';
import type {AdminIdentity} from './admin-auth.js';
import {extraDocument,extraRefundTotal} from '../pricing/ancillary-refund.contract.js';
import {priceMinor} from '../pricing/flight-pricing.contract.js';
import {FlightAncillaryPurchaseService} from '../flight/flight-ancillary-purchase.service.js';
import {confirmedAncillaryItems} from '../flight/ancillary-purchase.contract.js';
const conflict=(message:string)=>new ApiException('CONFLICT',message,409);
type State={scope:'ANCILLARY';requestId:string;document:string;purchaseId:string;stage:string;expiresAt:string;airlineCompleted?:boolean;message:string;supplierRefund?:string;refundCurrency?:string;[key:string]:unknown};
@Injectable()
export class AdminAncillaryRefundsService{
 constructor(@Inject(DATABASE_CONNECTION)private readonly connection:DatabaseConnection|undefined,@Inject(APP_CONFIG)private readonly config:AppConfig,@Inject(SABRE_BOOKING_CLIENT)private readonly sabre:SabreBookingManagementClient|undefined,@Inject(FlightTicketingService)private readonly ticketing:FlightTicketingService,@Inject(AdminFlightRefundsService)private readonly refunds:AdminFlightRefundsService,@Inject(FlightAncillaryPurchaseService)private readonly extras:FlightAncillaryPurchaseService){}
 private get db(){if(!this.connection)throw conflict('Extra refund storage is unavailable.');return this.connection.db;}
 private ready(staff:AdminIdentity,refund=true){if(!['owner','manager'].includes(staff.role))throw new ApiException('FORBIDDEN','Manager access is required.',403);if(!this.sabre||this.config.SABRE_ENV!=='CERT'||this.config.APP_ENV==='production'||this.config.FLIGHT_TICKET_SERVICING_EXECUTION_ENABLED!=='true'||!this.ticketing.servicingPrinters()||refund&&!this.refunds.available())throw conflict('CERT extra servicing configuration is unavailable.');}
 async documents(bookingId:string,pnr:string,staff:AdminIdentity,trace:string,checkOnly=false,api:AncillaryDocumentApi='BOOKING_MANAGEMENT'){
  this.ready(staff,false);
  const [row]=await this.db.select({booking:flightBookings,intent:flightBookingIntents,order:orders}).from(flightBookings).innerJoin(flightBookingIntents,eq(flightBookingIntents.id,flightBookings.bookingIntentId)).innerJoin(orders,eq(orders.bookingIntentId,flightBookingIntents.id)).where(eq(flightBookings.id,bookingId)).limit(1);
  if(!row||row.booking.pnrLocator!==pnr||row.booking.status!=='TICKETED')throw conflict('Verified flight tickets and the exact PNR are required before extra documents.');
  if(checkOnly)return this.extras.reconcile(row.booking.customerId,bookingId);
  const snapshot=row.intent.searchRequestSnapshot as AncillarySnapshot,purchase=snapshot.checkoutAncillaryPurchase,profile=this.ticketing.ancillarySettlementProfile();
  if(this.config.FLIGHT_ANCILLARY_EXECUTION_ENABLED!=='true'||!profile||purchase?.status!=='FULFILLMENT_PENDING'||purchase.documentAttempt?.status!=='NOT_STARTED'||row.order.status!=='PAID'||!row.order.paidAt)throw conflict('This extra-document operation is not ready or already has an attempt. Use Check documents without repeating issuance.');
  const paid=await this.db.select().from(payments).where(eq(payments.orderId,row.order.id));
  if(!paid.some(payment=>payment.customerId===row.booking.customerId&&payment.status==='SUCCEEDED'&&payment.provider==='STRIPE_TEST'&&payment.paidAt&&payment.amount===row.order.totalAmount&&payment.currency===row.order.currency))throw conflict('Verify the original client payment before issuing extra documents.');
  const current=await this.sabre!.getPurchaseBooking(pnr),names=(await this.connection!.pool.query('SELECT booked_passenger_names AS names FROM flight_bookings WHERE id=$1',[bookingId])).rows[0]?.names;
  if(current.bookingId!==row.booking.sabreBookingId||!Array.isArray(names)||current.travelers.length!==names.length||current.travelers.some((p,index)=>(String(p.givenName)+' '+String(p.surname)).trim().toUpperCase()!==String(names[index]).trim().toUpperCase()))throw conflict('The extra-service reservation or travelers differ.');
  const evidence=confirmedAncillaryItems(current,purchase.plans,snapshot.checkoutAncillaryRequests??[]);
  if(evidence.length!==purchase.items.length||evidence.some(item=>!purchase.items.some(expected=>expected.requestId===item.requestId&&expected.providerAncillaryIds.includes(item.itemId)&&expected.airlineCurrency===item.currency&&priceMinor(expected.airlineAmount)===priceMinor(item.amount))))throw conflict('The purchased extra amounts or associations changed.');
  const ids=purchase.items.flatMap(item=>item.providerAncillaryIds);
  if(!['BOOKING_MANAGEMENT','ENHANCED_AIR_TICKET'].includes(api))throw conflict('Select a supported document API.');
  if(api==='ENHANCED_AIR_TICKET')buildEnhancedAirExtras(pnr,this.config.SABRE_PCC!,profile,ids);
  if(current.travelers.some(person=>Array.isArray(person.ancillaries)&&person.ancillaries.some(extra=>ids.includes(String(extra.itemId))&&extra.electronicMiscellaneousDocumentNumber)))throw conflict('An extra document is already visible. Check documents; do not issue again.');
  await this.db.transaction(async tx=>{
   const [intent]=await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,row.intent.id)).for('update');
   const [order]=await tx.select().from(orders).where(eq(orders.id,row.order.id)).for('update');
   const [booking]=await tx.select().from(flightBookings).where(eq(flightBookings.id,bookingId)).for('update');
   const cases=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.bookingId,bookingId));
   const fresh=intent!.searchRequestSnapshot as AncillarySnapshot;
   if(booking?.status!=='TICKETED'||order?.status!=='PAID'||!order.paidAt||JSON.stringify(fresh.checkoutAncillaryPurchase)!==JSON.stringify(purchase)||cases.some(c=>!['COMPLETED','CANCELLED','FAILED'].includes(c.status)))throw conflict('Payment, extras or servicing changed before document dispatch.');
   await tx.update(flightBookingIntents).set({searchRequestSnapshot:{...fresh,checkoutAncillaryPurchase:{...purchase,documentAttempt:{status:'CLAIMED',claimedAt:new Date().toISOString(),api,requestId:trace},message:'Extra-service document issuance was claimed. Do not submit another request.'}},updatedAt:new Date()}).where(eq(flightBookingIntents.id,intent!.id));
   await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.extra_documents.claimed',resourceType:'flight_booking',resourceId:bookingId,requestId:trace});
  });
  let diagnostic:AncillaryDocumentDiagnostic;
  try{
   const result=api==='ENHANCED_AIR_TICKET'?await this.sabre!.issueEnhancedAncillaryDocuments(pnr,profile,ids,names.flatMap((name:string)=>[name,...name.split(/\s+/)])):await this.sabre!.fulfillAncillaryDocuments(pnr,profile,ids);
   const raw=result as {errors?:unknown;warnings?:unknown},dispatch=this.sabre!.dispatchReference(result),supplierRequestId=this.sabre!.responseReference(result);
   diagnostic={api,recordedAt:new Date().toISOString(),reason:'SUPPLIER_RESPONSE_RECORDED',errors:sanitizedTicketingErrors(raw.errors),warnings:sanitizedTicketingErrors(raw.warnings),httpStatus:200,...(supplierRequestId?{supplierRequestId}:{}),...(dispatch?{requestSha256:dispatch.requestSha256}:{})};
  }catch(error){
   const info=error instanceof SabreBookingUnknownError?error.diagnostic:undefined;
   diagnostic={api,recordedAt:new Date().toISOString(),reason:'SUPPLIER_RESPONSE_UNCONFIRMED',errors:sanitizedTicketingErrors(info?.errors??(error instanceof SabreBookingRejectedError?error.diagnostics:undefined)),warnings:sanitizedTicketingErrors(info?.warnings),...(error instanceof SabreBookingUnknownError||error instanceof SabreBookingRejectedError?{httpStatus:error.httpStatus}:{}),...(info?.supplierRequestId?{supplierRequestId:info.supplierRequestId}:{}),...(info?.dispatch?{requestSha256:info.dispatch.requestSha256}:{})};
  }
  // Preserve safe provider evidence before a subsequent read or process restart.
  await this.db.transaction(async tx=>{
   const [intent]=await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,row.intent.id)).for('update'),fresh=intent!.searchRequestSnapshot as AncillarySnapshot;
   if(fresh.checkoutAncillaryPurchase?.documentAttempt?.status!=='CLAIMED')return;
   await tx.update(flightBookingIntents).set({searchRequestSnapshot:{...fresh,checkoutAncillaryPurchase:{...fresh.checkoutAncillaryPurchase,documentAttempt:{...fresh.checkoutAncillaryPurchase.documentAttempt,diagnostic}}},updatedAt:new Date()}).where(eq(flightBookingIntents.id,intent!.id));
  });
  try{return await this.extras.reconcile(row.booking.customerId,bookingId);}catch{
   await this.db.transaction(async tx=>{
    const [intent]=await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,row.intent.id)).for('update'),fresh=intent!.searchRequestSnapshot as AncillarySnapshot;
    if(fresh.checkoutAncillaryPurchase?.documentAttempt?.status!=='CLAIMED')return;
    await tx.update(flightBookingIntents).set({searchRequestSnapshot:{...fresh,checkoutAncillaryPurchase:{...fresh.checkoutAncillaryPurchase,documentAttempt:{...fresh.checkoutAncillaryPurchase.documentAttempt,status:'UNKNOWN'},message:'The extra documents remain unconfirmed. Check documents only; issuance will not be repeated.'}},updatedAt:new Date()}).where(eq(flightBookingIntents.id,intent!.id));
   });throw conflict('Extra-service document issuance is unconfirmed. The flight remains ticketed. Check documents without another issuance request.');
  }
 }
 private async saved(bookingId:string,requestId:string){
  const [row]=await this.db.select({booking:flightBookings,intent:flightBookingIntents,order:orders}).from(flightBookings).innerJoin(flightBookingIntents,eq(flightBookingIntents.id,flightBookings.bookingIntentId)).innerJoin(orders,eq(orders.bookingIntentId,flightBookingIntents.id)).where(eq(flightBookings.id,bookingId)).limit(1);
  const purchase=(row?.intent.searchRequestSnapshot as AncillarySnapshot|undefined)?.checkoutAncillaryPurchase,item=purchase?.items.find(item=>item.requestId===requestId);
  if(!row||row.booking.status!=='TICKETED'||row.order.status!=='PAID'||!row.order.paidAt||!row.booking.pnrLocator||!purchase||!['CONFIRMED','FULFILLMENT_PENDING','FULFILLED'].includes(purchase.status)||!item||priceMinor(row.order.discountAmount)!==0n)throw conflict('A paid, ticketed reservation and uniquely purchased extra without a coupon discount are required.');
  if(priceMinor(item.checkoutAmount)<=0n)throw conflict('There is no paid amount to refund for this extra.');
  const paid=await this.db.select().from(payments).where(eq(payments.orderId,row.order.id));
  if(!paid.some(payment=>payment.customerId===row.booking.customerId&&payment.status==='SUCCEEDED'&&payment.provider==='STRIPE_TEST'&&payment.paidAt&&payment.currency===row.order.currency&&priceMinor(payment.amount)===priceMinor(row.order.totalAmount)))throw conflict('The original sandbox payment is not verified.');
  return {...row,purchase,item};
 }
 private async document(row:Awaited<ReturnType<AdminAncillaryRefundsService['saved']>>,refunded=false){
  const current=await this.sabre!.getAncillaryDocumentBooking(row.booking.pnrLocator!);
  const names=(await this.connection!.pool.query("SELECT booked_passenger_names AS names FROM flight_bookings WHERE id=$1",[row.booking.id])).rows[0]?.names;
  if(current.bookingId!==row.booking.sabreBookingId||!Array.isArray(names)||names.length!==current.travelers.length||current.travelers.some((person,index)=>(String(person.givenName)+' '+String(person.surname)).trim().replace(/\s+/g,' ').toUpperCase()!==String(names[index]).trim().replace(/\s+/g,' ').toUpperCase()))throw conflict('The extra document reservation or traveler identity differs.');
  try{return extraDocument(current,row.item,this.config.SABRE_PCC!,refunded);}catch(e){throw conflict((e as Error).message);}
 }
 async prepare(bookingId:string,requestId:string,staff:AdminIdentity,trace:string){
  this.ready(staff);const row=await this.saved(bookingId,requestId),document=await this.document(row),amount=extraRefundTotal(row.item,row.item.airlineAmount,row.item.airlineCurrency);
  return this.db.transaction(async tx=>{
   const [booking]=await tx.select().from(flightBookings).where(eq(flightBookings.id,bookingId)).for('update');
   if(booking?.status!=='TICKETED')throw conflict('The flight changed during refund preparation.');
   const history=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.bookingId,bookingId));
   if(history.some(record=>!['COMPLETED','CANCELLED','FAILED'].includes(record.status)||(record.result as State|null)?.scope==='ANCILLARY'&&(record.result as State).requestId===requestId&&record.status!=='CANCELLED'))throw conflict('Resolve the existing servicing case or refund for this extra first.');
   const state:State={scope:'ANCILLARY',requestId,document,purchaseId:row.purchase.id,purchaseFingerprint:createHash('sha256').update(JSON.stringify(row.purchase)).digest('hex'),stage:'EXTRA_REFUND_PREPARED',expiresAt:new Date(Date.now()+10*60000).toISOString(),message:'Maximum extra refund prepared. The airline determines the actual refund; the Flyseri charge follows that verified amount. The flight is retained.'};
   const [record]=await tx.insert(flightServicingCases).values({bookingId,kind:'REFUND',status:'QUOTED',reason:'Refund extra: '+row.item.name,createdByStaffId:staff.staffUserId,result:state,quote:{currency:row.order.currency,amount:amount.customerRefund,airlinePenalty:'0',serviceFee:'0',fareDifference:'0',refundAmount:amount.customerRefund,evidenceReference:document,expiresAt:state.expiresAt}}).returning();
   await tx.insert(flightServicingEvents).values({caseId:record!.id,staffUserId:staff.staffUserId,event:'EXTRA_REFUND_PREPARED',note:row.item.name});
   await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.extra_refund.prepared',resourceType:'flight_servicing_case',resourceId:record!.id,requestId:trace});return record;
  });
 }
 async action(id:string,action:string,version:number,pnr:string,staff:AdminIdentity,trace:string){
  this.ready(staff);if(!Number.isInteger(version))throw conflict('Refresh the case version.');
  const [record]=await this.db.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)),state=record?.result as State|undefined;
  if(!record||record.version!==version||state?.scope!=='ANCILLARY')throw conflict('Refresh this extra refund case.');
  const row=await this.saved(record.bookingId,state.requestId);if(pnr!==row.booking.pnrLocator||state.purchaseId!==row.purchase.id||state.purchaseFingerprint!==createHash('sha256').update(JSON.stringify(row.purchase)).digest('hex'))throw conflict('Confirm the original PNR and unchanged extra purchase.');
  if(action==='CANCEL'){
   if(record.status!=='QUOTED'||state.stage!=='EXTRA_REFUND_PREPARED')throw conflict('Only an unsubmitted extra refund draft can be discarded.');
   const changed=await this.db.update(flightServicingCases).set({status:'CANCELLED',version:version+1,updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,version),eq(flightServicingCases.status,'QUOTED'))).returning({id:flightServicingCases.id});if(!changed.length)throw conflict('The case changed.');return;
  }
  if(action==='SETTLE'){
   if(state.airlineCompleted!==true||state.stage!=='CUSTOMER_REFUND_PENDING')throw conflict('A verified airline extra refund is required before returning customer money.');
   if(await this.document(row,true)!==state.document)throw conflict('The refunded extra document changed.');
   await this.refunds.settle(id,version,pnr,staff,trace);return;
  }
  if(action==='RECONCILE'){
   if(state.stage?.startsWith('CUSTOMER_REFUND')&&state.airlineCompleted){await this.refunds.reconcile(id,staff,trace);return;}
   throw conflict('The supplier refund outcome needs specialist evidence. No second airline refund will be sent.');
  }
  if(action!=='EXECUTE'||record.status!=='QUOTED'||state.stage!=='EXTRA_REFUND_PREPARED'||Date.parse(state.expiresAt)<=Date.now())throw conflict('Prepare a current extra refund before one confirmed execution.');
  if(await this.document(row)!==state.document)throw conflict('The extra document changed.');
  await this.db.transaction(async tx=>{
   const [booking]=await tx.select().from(flightBookings).where(eq(flightBookings.id,row.booking.id)).for('update');
   const [current]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
   const active=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.bookingId,row.booking.id));
   if(booking?.status!=='TICKETED'||!current||current.version!==version||current.status!=='QUOTED'||active.some(c=>c.id!==id&&!['COMPLETED','CANCELLED','FAILED'].includes(c.status)))throw conflict('The booking or refund changed before dispatch.');
   await tx.update(flightServicingCases).set({status:'EXECUTING',version:version+1,approval:{staffUserId:staff.staffUserId,pnr,approvedAt:new Date().toISOString()},result:{...state,stage:'EXTRA_REFUND_SENDING'},updatedAt:new Date()}).where(eq(flightServicingCases.id,id));
   await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'EXTRA_REFUND_CLAIMED',note:'Exactly one EMD-only supplier request. Flight tickets retained.'});
   await tx.insert(adminAuditEvents).values({staffUserId:staff.staffUserId,staffRole:staff.role,event:'flight.extra_refund.claimed',resourceType:'flight_servicing_case',resourceId:id,requestId:trace});
  });
  try{
   const raw=await this.sabre!.refundAncillaryDocument(pnr,state.document,this.ticketing.servicingPrinters()!) as {errors?:unknown[];refundedTickets?:string[];tickets?:{number:string;refundTotals?:{total:string;currencyCode:string}}[]};
   if(raw.errors?.length||raw.refundedTickets?.length!==1||raw.refundedTickets[0]!==state.document)throw conflict('The airline extra refund was not confirmed.');
   const returned=raw.tickets?.filter(ticket=>ticket.number===state.document);if(returned?.length!==1||!returned[0]!.refundTotals)throw conflict('The supplier refund amount was not returned.');
   const totals=returned[0]!.refundTotals,amount=extraRefundTotal(row.item,totals.total,totals.currencyCode);
   if(await this.document(row,true)!==state.document)throw conflict('The extra refund has not been independently verified.');
   await this.db.transaction(async tx=>{
    const [current]=await tx.select().from(flightServicingCases).where(eq(flightServicingCases.id,id)).for('update');
    if(current?.version!==version+1||current.status!=='EXECUTING')throw conflict('The refund evidence needs reconciliation.');
    await tx.update(flightServicingCases).set({status:priceMinor(amount.customerRefund)>0n?'EXECUTING':'COMPLETED',version:version+2,result:{...state,...amount,airlineCompleted:true,stage:priceMinor(amount.customerRefund)>0n?'CUSTOMER_REFUND_PENDING':'COMPLETED',message:'Airline extra refund verified. Review the exact customer amount before settling the original sandbox payment. The flight is retained.'},quote:{...(current.quote as object),refundAmount:amount.customerRefund,amount:amount.customerRefund},updatedAt:new Date()}).where(eq(flightServicingCases.id,id));
    await tx.insert(flightServicingEvents).values({caseId:id,staffUserId:staff.staffUserId,event:'EXTRA_REFUND_VERIFIED',note:row.order.currency+' '+amount.customerRefund+' includes charge refund '+amount.chargeRefund});
   });
  }catch{
   await this.db.update(flightServicingCases).set({status:'OUTCOME_UNKNOWN',version:version+2,result:{...state,stage:'EXTRA_REFUND_UNKNOWN',message:'The airline extra refund is unconfirmed. Do not retry or refund customer money without verified supplier evidence.'},updatedAt:new Date()}).where(and(eq(flightServicingCases.id,id),eq(flightServicingCases.version,version+1)));
  }
 }
}
