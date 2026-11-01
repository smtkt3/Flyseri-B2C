import {Inject,Injectable,Logger,type OnModuleInit,type OnModuleDestroy} from '@nestjs/common';
import {and,eq,sql} from 'drizzle-orm';
import {flightBookings,flightBookingIntents,auditEvents,type DatabaseConnection} from '@flyseri/database';
import type {AppConfig} from '@flyseri/config';
import type {FlightBooking} from '@flyseri/types';
import {APP_CONFIG,DATABASE_CONNECTION} from '../tokens.js';
import {FlightBookingsService} from './flight-bookings.service.js';
import {ApiException} from '../api-exception.js';
import {ticketDocumentAvailable,currentTicketNumbers,type TicketDeliverySnapshot} from './ticket-document.contract.js';
import {createTicketPdf} from './ticket-pdf.js';
import {smtpTicketReady,sendTicketSmtp} from './ticket-email.js';

@Injectable()
export class TicketDocumentsService implements OnModuleInit,OnModuleDestroy{
 private timer:ReturnType<typeof setInterval>|undefined;private running=false;private finished:Promise<void>=Promise.resolve();private readonly logger=new Logger(TicketDocumentsService.name);
 constructor(@Inject(APP_CONFIG) private readonly config:AppConfig,@Inject(DATABASE_CONNECTION) private readonly connection:DatabaseConnection|undefined,@Inject(FlightBookingsService) private readonly bookings:FlightBookingsService){}
 onModuleInit(){if(this.connection&&smtpTicketReady(this.config)){this.timer=setInterval(()=>void this.runOnce().catch(()=>this.logger.warn('Ticket email queue unavailable')),15000);this.timer.unref();}}
 onModuleDestroy(){if(this.timer)clearInterval(this.timer);}
 async pdf(customerId:string,bookingId:string){
  const booking=await this.bookings.detail(customerId,bookingId);
  if(!ticketDocumentAvailable(booking))throw new ApiException('CONFLICT','A PDF is available after current ticket issuance is verified.',409);
  return {buffer:await createTicketPdf(booking,this.config.SABRE_ENV),filename:'Flyseri-e-ticket-'+booking.pnr+'.pdf'};
 }
 async deliveryStatus(customerId:string,bookingId:string){
  const booking=await this.bookings.detail(customerId,bookingId);
  if(!this.connection)throw new ApiException('DEPENDENCY_UNAVAILABLE','Ticket delivery is unavailable.',503);
  const [intent]=await this.connection.db.select().from(flightBookingIntents).where(and(eq(flightBookingIntents.id,booking.bookingIntentId),eq(flightBookingIntents.customerId,customerId)));
  const saved=(intent?.searchRequestSnapshot as TicketDeliverySnapshot)?.ticketEmail;
  const job=booking.providerView&&saved&&JSON.stringify(currentTicketNumbers(booking.providerView))===JSON.stringify(saved.ticketNumbers)?saved:undefined;
  return {available:ticketDocumentAvailable(booking),emailStatus:job?.status==='SENT'?'SENT':job?.status==='REVIEW_REQUIRED'?'REVIEW_REQUIRED':job?.status==='QUEUED'||job?.status==='SENDING'?(smtpTicketReady(this.config)?'QUEUED':'NOT_CONFIGURED'):'NOT_QUEUED',sentAt:job?.sentAt??null};
 }
 async deliverAfterVerification(bookingId:string){try{await this.runOnce(bookingId);}catch{this.logger.warn('Verified ticket email remains queued');}}
 async runOnce(bookingId?:string):Promise<void>{
  if(!this.connection||!smtpTicketReady(this.config))return;
  if(this.running){if(bookingId){await this.finished;return this.runOnce(bookingId);}return;}
  this.running=true;let release!:()=>void;this.finished=new Promise<void>(resolve=>{release=resolve;});
  try{
   const candidates=await this.connection.db.select({id:flightBookings.id,customerId:flightBookings.customerId,intentId:flightBookingIntents.id}).from(flightBookings).innerJoin(flightBookingIntents,eq(flightBookingIntents.id,flightBookings.bookingIntentId)).where(and(eq(flightBookings.status,'TICKETED'),bookingId?eq(flightBookings.id,bookingId):undefined,sql`${flightBookingIntents.searchRequestSnapshot}->'ticketEmail'->>'status' IN ('QUEUED','SENDING')`)).limit(10);
   for(const candidate of candidates){
    let booking:FlightBooking;try{booking=await this.bookings.detail(candidate.customerId,candidate.id);}catch{continue;}
    const job=await this.connection.db.transaction(async tx=>{
     const [intent]=await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,candidate.intentId)).for('update');
     if(!intent)return;
     const [lockedBooking]=await tx.select().from(flightBookings).where(eq(flightBookings.id,candidate.id)).for('update');
     const snapshot=intent?.searchRequestSnapshot as TicketDeliverySnapshot,queued=snapshot?.ticketEmail;
     if(!queued||!lockedBooking||lockedBooking.updatedAt.toISOString()!==booking.updatedAt||lockedBooking.status!=='TICKETED')return;
     if(queued.status==='SENDING'){
      if(queued.claimedAt&&Date.parse(queued.claimedAt)<Date.now()-10*60000)await tx.update(flightBookingIntents).set({searchRequestSnapshot:{...snapshot,ticketEmail:{...queued,status:'REVIEW_REQUIRED'}}}).where(eq(flightBookingIntents.id,intent.id));
      return;
     }
     if(queued.status!=='QUEUED')return;
     if(!ticketDocumentAvailable(booking)||JSON.stringify(currentTicketNumbers(booking.providerView!))!==JSON.stringify(queued.ticketNumbers)){
      await tx.update(flightBookingIntents).set({searchRequestSnapshot:{...snapshot,ticketEmail:{...queued,status:'SUPERSEDED'}}}).where(eq(flightBookingIntents.id,intent.id));return;
     }
     await tx.update(flightBookingIntents).set({searchRequestSnapshot:{...snapshot,ticketEmail:{...queued,status:'SENDING',claimedAt:new Date().toISOString()}}}).where(eq(flightBookingIntents.id,intent.id));return queued;
    });
    if(!job)continue;
    let status:'SENT'|'REVIEW_REQUIRED'='REVIEW_REQUIRED';
    try{const pdf=await createTicketPdf(booking,this.config.SABRE_ENV);const current=await this.bookings.detail(candidate.customerId,candidate.id);if(current.updatedAt!==booking.updatedAt||!ticketDocumentAvailable(current))throw Error('Booking changed before email');await sendTicketSmtp(this.config,job.recipient,job.id,booking,pdf);status='SENT';}catch{/* Never log addresses, credentials or SMTP transcripts; uncertainty is not retried. */}
    await this.connection.db.transaction(async tx=>{
     const [intent]=await tx.select().from(flightBookingIntents).where(eq(flightBookingIntents.id,candidate.intentId)).for('update');if(!intent)return;const snapshot=intent.searchRequestSnapshot as TicketDeliverySnapshot;
     if(snapshot?.ticketEmail?.id!==job.id||snapshot.ticketEmail.status!=='SENDING')return;
     await tx.update(flightBookingIntents).set({searchRequestSnapshot:{...snapshot,ticketEmail:{...snapshot.ticketEmail,status,...(status==='SENT'?{sentAt:new Date().toISOString()}: {})}}}).where(eq(flightBookingIntents.id,intent.id));
     await tx.insert(auditEvents).values({actorCustomerId:candidate.customerId,event:status==='SENT'?'flight.ticket_email.smtp_accepted':'flight.ticket_email.review_required'});
    });
   }
  }finally{this.running=false;release();}
 }
}
