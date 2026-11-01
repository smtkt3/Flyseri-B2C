import 'reflect-metadata';
import {it,expect} from 'vitest';
import {Test} from '@nestjs/testing';
import request from 'supertest';
import {parseConfig} from '@flyseri/config';
import {FlightController} from './flight.controller.js';
import {TicketDocumentsService} from './ticket-documents.service.js';
import {FlightBookingsService} from './flight-bookings.service.js';
import {FlightTicketingService} from './flight-ticketing.service.js';
import {BookingIntentService} from './booking-intent.service.js';
import {FlightAncillariesService} from './flight-ancillaries.service.js';
import {FlightAncillaryPurchaseService} from './flight-ancillary-purchase.service.js';
import {CustomerAuthGuard} from '../customer/auth.js';
import {ApiException} from '../api-exception.js';
import {APP_CONFIG,REDIS_STORE,FLIGHT_TELEMETRY,TOKEN_VERIFIER,CUSTOMER_STORE} from '../tokens.js';
import {ticketFixture} from './ticket-document.fixture.js';
it('requires authentication and ownership for the non-cacheable PDF and blocks unissued bookings',async()=>{
 const config=parseConfig({APP_ENV:'test'}),booking=ticketFixture(),owner='00000000-0000-4000-8000-000000000010';
 const bookings={detail:async(customerId:string,id:string)=>{if(customerId!==owner||id!==booking.id)throw new ApiException('NOT_FOUND','Booking not found.',404);return booking;}};
 const documents=new TicketDocumentsService(config,undefined,bookings as never);
 const module=await Test.createTestingModule({controllers:[FlightController],providers:[CustomerAuthGuard,{provide:APP_CONFIG,useValue:config},{provide:REDIS_STORE,useValue:undefined},{provide:FLIGHT_TELEMETRY,useValue:{}},{provide:TOKEN_VERIFIER,useValue:{verify:async(token:string)=>token==='owner'?{authUserId:owner}:token==='other'?{authUserId:'00000000-0000-4000-8000-000000000011'}:null}},{provide:CUSTOMER_STORE,useValue:{bootstrap:async(id:string)=>({id,status:'ACTIVE',profile:{}})}},{provide:FlightBookingsService,useValue:bookings},{provide:TicketDocumentsService,useValue:documents},...[FlightTicketingService,BookingIntentService,FlightAncillariesService,FlightAncillaryPurchaseService].map(provide=>({provide,useValue:{}}))]}).compile();
 const app=module.createNestApplication({logger:false});app.setGlobalPrefix('api/v1');await app.init();
 try{
  const path='/api/v1/flights/bookings/'+booking.id+'/ticket.pdf';
  await request(app.getHttpServer()).get(path).expect(401);
  await request(app.getHttpServer()).get(path).set('Authorization','Bearer other').expect(404);
  const response=await request(app.getHttpServer()).get(path).set('Authorization','Bearer owner').expect(200);
  expect(response.headers['content-type']).toContain('application/pdf');expect(response.headers['cache-control']).toBe('private, no-store');expect(response.headers['content-disposition']).toContain('Flyseri-e-ticket-TESTBG.pdf');
  expect(Buffer.isBuffer(response.body)).toBe(true);expect(response.body.subarray(0,5).toString()).toBe('%PDF-');
  booking.status='MANUAL_REVIEW_REQUIRED';await request(app.getHttpServer()).get(path).set('Authorization','Bearer owner').expect(409);
 }finally{await app.close();}
},20000);
