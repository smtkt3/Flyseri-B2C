import {describe,it,expect} from 'vitest';
import type {AppConfig} from '@flyseri/config';
import {ticketingOperatorChecks,supportReconciliationEvidence} from './ticketing-diagnostics.contract.js';
import {FlightTicketingService} from './flight-ticketing.service.js';
import type {FlightBookingsService} from './flight-bookings.service.js';
describe('safe ticketing diagnostics and manual evidence',()=>{
 it('keeps automatic and customer dispatch unavailable in the approved-admin workflow',async()=>{
  const service=new FlightTicketingService({SABRE_ENV:'CERT',FLIGHT_AUTOMATIC_TICKETING_ENABLED:'true',FLIGHT_CUSTOMER_TICKETING_ENABLED:'true'} as AppConfig,undefined,undefined,{} as FlightBookingsService);
  expect(await service.capabilities()).toMatchObject({automaticTicketingEnabled:false,customerTicketingEnabled:false});
 });
 it('separates configured identity from unknown effective permissions and excludes credentials',()=>{
  const result=ticketingOperatorChecks({SABRE_PCC:'BD01',SABRE_USERNAME:'123456-BD01-AA',SABRE_PASSWORD:'private-password',SABRE_TICKETING_PROFILE:JSON.stringify({hardcopyPrinterAddress:'ABC123',formOfPayment:'CASH',cardNumber:'private-card'})} as AppConfig);
  expect(result).toMatchObject({configuredEpr:'123456',credentialPcc:'BD01',effectiveEpr:'UNKNOWN',printerConfigured:true,permissions:{eprTicketing:'UNKNOWN',carrierStock:'UNKNOWN',printerDesignation:'UNKNOWN',settlement:'UNKNOWN'}});
  expect(JSON.stringify(result)).not.toMatch(/private|password|cardNumber|ABC123/);
 });
 const evidence={source:'SABRE_SUPPORT_PORTAL',reference:'CASE-1234',confirmedPnr:'ABC123',confirmedPcc:'BD01',outcome:'NO_TICKETS_REPORTED',ticketNumbers:[],channelAuthenticated:true,salesReportScope:'PCC_NOT_CONFIRMED'};
 it('accepts a bounded operator attestation without making it an issuance or retry instruction',()=>expect(supportReconciliationEvidence(evidence)).toMatchObject(evidence));
 it.each([{...evidence,channelAuthenticated:false},{...evidence,confirmedPnr:'abc_12'},{...evidence,reference:'secret@example.com'},{...evidence,outcome:'TICKETS_REPORTED'},{...evidence,ticketNumbers:['9971234567890']},{...evidence,unlock:true},{...evidence,salesReportScope:'PCC_CONFIRMED'}])('rejects invalid or privilege-expanding support evidence %j',value=>expect(()=>supportReconciliationEvidence(value)).toThrow());
});
