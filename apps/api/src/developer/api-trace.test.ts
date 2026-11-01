import {expect,it} from 'vitest';
import {redactTrace,traceIssues} from './api-trace.js';
import {sanitizedTicketingErrors} from '../flight/ticketing-currency.contract.js';
it('shows HTTP-success exchange failures and stored exchange diagnostics without private provider text',()=>{
 const raw={ExchangeBookingRS:{ApplicationResults:{status:'Incomplete',Error:[{SystemSpecificResults:[{Message:[{code:'ERR.SP.PROVIDER_ERROR',content:'PrivateName AutomatedExchangesLLSRQ: WFRF ENTRY NOT AVAILABLE'}]}]}],Warning:[{SystemSpecificResults:[{Message:[{code:'WARN.SP.PROVIDER_WARNING',content:'Unable to perform automated exchanges confirmation step. Comparison step did not generate PQR Number'}]}]}]}}};
 const issue=traceIssues(raw);expect(issue).toMatchObject({result:'ERROR',source:'RESPONSE',errorCount:1,warningCount:1,errors:[{description:'WFRF ENTRY NOT AVAILABLE',providerMessageCodes:['ERR.SP.PROVIDER_ERROR'],supplierOperations:['AutomatedExchangesLLSRQ']}]});
 expect(JSON.stringify(issue)).not.toContain('PrivateName');
 const stored={data:{status:'OUTCOME_UNKNOWN',result:{exchangeDiagnostic:{errors:issue.errors,warnings:issue.warnings}}}};
 expect(traceIssues(stored)).toMatchObject({result:'ERROR',source:'STORED_CASE_DIAGNOSTIC',errorCount:1,warningCount:1});
 expect(traceIssues({...stored,data:{...stored.data,status:'COMPLETED'}}).errorCount).toBe(0);
 expect(redactTrace({PostProcessing:{acceptPriceChanges:false,actionOnPQExpired:'Q',actionOnBackDatePrice:'Q'}})).toMatchObject({PostProcessing:{acceptPriceChanges:false,actionOnPQExpired:'Q',actionOnBackDatePrice:'Q'}});
});
it('shows a safe pre-submission database code without query values',()=>{
 const safe=redactTrace({result:{preSubmissionDiagnostic:{classification:'NOT_SUBMITTED',phase:'PREFLIGHT',reason:'LOCAL_PREFLIGHT_FAILED',databaseCode:'55P03',supplierMutationAttempted:false,automaticRetry:false,query:'private@example.com',parameters:['secret']}}});
 expect(safe).toMatchObject({result:{preSubmissionDiagnostic:{classification:'NOT_SUBMITTED',phase:'PREFLIGHT',databaseCode:'55P03',supplierMutationAttempted:false}}});
 expect(JSON.stringify(safe)).not.toMatch(/private@example.com|secret/);
});

it('keeps the real admin action fields while protecting the PNR and private data',()=>{
 const result=redactTrace({action:'EXECUTE',version:4,confirmedPnr:'ABC123',password:'private-password',unexpectedField:'private-value'});
 expect(result).toMatchObject({action:'EXECUTE',version:4,confirmedPnr:'[REDACTED]',password:'[REDACTED]'});
 expect(JSON.stringify(result)).not.toMatch(/ABC123|private-password|private-value/);
});
it('keeps fulfillment field names and payment references without exposing payment credentials',()=>{
 const result=redactTrace({confirmationId:'ABC123',targetPcc:'73H8',fulfillments:[{ticketingQualifiers:{priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'},payment:{primaryFormOfPayment:1}}],formsOfPayment:[{type:'CASH',cardNumber:'4111111111111111'}],designatePrinters:[{hardcopy:{address:'ABC123'}},{ticket:{countryCode:'BD'}}]});
 expect(result).toMatchObject({confirmationId:'[REDACTED]',targetPcc:'73H8',fulfillments:[{ticketingQualifiers:{priceQuoteRecordIds:['1'],validatingAirlineCode:'BG'},payment:{primaryFormOfPayment:1}}],formsOfPayment:[{type:'CASH',cardNumber:'[REDACTED]'}]});
 expect(JSON.stringify(result)).not.toMatch(/ABC123|4111111111111111|unknown field/);
});
it('preserves original provider codes and fingerprints in the response and issue summary',()=>{
 const [error]=sanitizedTicketingErrors([{category:'APPLICATION_ERROR',type:'DOWNLINE_SERVICE_ERROR',description:'AirTicketLLSRQ: Private passenger text-0316; TicketingDocumentServicesRQ: No new tickets have been issued'}]);
 const source={success:true,data:{kind:'ISSUE',version:5,quote:{ticketing:{commitWaitMs:10000,quoteHandling:'Quit'},serviceFee:'0.00'},result:{stage:'TICKET_CONFIRMATION_PENDING',airlineCompleted:false,ticketingDiagnostic:{errors:[error],dispatch:{requestSha256:'a'.repeat(64),sentAt:'2026-10-26T03:30:13.279Z',printerDesignationRequested:true},responseKeys:['timestamp','request','errors']}}}};
 const safe=redactTrace(source);
 expect(safe).toMatchObject({data:{kind:'ISSUE',version:5,quote:{ticketing:{commitWaitMs:10000,quoteHandling:'Quit'},serviceFee:'0.00'},result:{ticketingDiagnostic:{errors:[{providerCodes:['0316'],descriptionFingerprint:error?.descriptionFingerprint,unclassifiedAirTicketMessage:true,description:'TicketingDocumentServicesRQ: No new tickets have been issued'}],dispatch:{requestSha256:'a'.repeat(64),printerDesignationRequested:true},responseKeys:['timestamp','request','errors']}}}});
 expect(JSON.stringify(safe)).not.toMatch(/Private passenger|unknown field/);
 expect(traceIssues(source)).toMatchObject({result:'ERROR',source:'STORED_CASE_DIAGNOSTIC',errors:[{providerCodes:['0316'],descriptionFingerprint:error?.descriptionFingerprint,unclassifiedAirTicketMessage:true}]});
});
it('does not pass arbitrary strings through diagnostic metadata fields',()=>{
 const result=redactTrace({providerCodes:['0316','secret@example.com'],descriptionFingerprint:'private-fingerprint',requestSha256:'private-hash',unclassifiedAirTicketMessage:'private-message',description:'private provider response'});
 expect(result).toMatchObject({providerCodes:['0316','[REDACTED]'],descriptionFingerprint:'[REDACTED]',requestSha256:'[REDACTED]',unclassifiedAirTicketMessage:'[REDACTED]',description:'[REDACTED]'});
});
it('shows supplier payment errors separately from the client payment, without exposing card data',()=>{
 const source={errors:[{type:'PAYMENT_CARD_DECLINED',category:'APPLICATION_ERROR',description:'PrivateName card 4111111111111111 ABC123'}]};
 expect(traceIssues(source)).toMatchObject({result:'ERROR',errors:[{type:'PAYMENT_CARD_DECLINED',description:'The supplier payment card was declined.'}]});
 const safe=redactTrace(source);
 expect(safe).toMatchObject({errors:[{type:'PAYMENT_CARD_DECLINED',description:'The supplier payment card was declined.'}]});
 expect(JSON.stringify(safe)).not.toMatch(/PrivateName|4111111111111111|ABC123/);
});
it('shows recovered document checks and original request identity without exposing ticket data',()=>{
 const requestId='123e4567-e89b-42d3-a456-426614174000';
 const safe=redactTrace({data:{result:{ticketRecovery:{verification:'VERIFIED',lookupCount:2,originalSupplierRequestId:requestId,checks:[{verification:'NO_TICKETS_REPORTED',documentCount:0,checkedAt:'2026-10-26T09:39:34.678Z',supplierRequestId:requestId}],reconciliationReasons:['DOCUMENT_AMOUNT_OR_CURRENCY_MISMATCH','private@example.com'],automaticRetry:false,ticketNumbers:['9971234567890']}}}});
 expect(safe).toMatchObject({data:{result:{ticketRecovery:{verification:'VERIFIED',lookupCount:2,originalSupplierRequestId:requestId,checks:[{verification:'NO_TICKETS_REPORTED',documentCount:0,supplierRequestId:requestId}],reconciliationReasons:['DOCUMENT_AMOUNT_OR_CURRENCY_MISMATCH','[REDACTED]'],automaticRetry:false}}}});
 expect(JSON.stringify(safe)).not.toMatch(/unknown field|9971234567890|private@example.com/);
});
it('recognizes Enhanced Air Ticket application failures and masks printer and document data',()=>{
 const source={AirTicketRS:{ApplicationResults:{status:'Incomplete',Error:[{type:'Application',SystemSpecificResults:[{Message:[{code:'0316',content:'AirTicketLLSRQ: Private Passenger-0316; TicketingDocumentServicesRQ: No new tickets have been issued'}]}]}]}}};
 expect(traceIssues(source)).toMatchObject({result:'ERROR',source:'RESPONSE',errors:[{providerCodes:['0316'],unclassifiedAirTicketMessage:true}]});
 const safe=redactTrace({AirTicketRQ:{version:'1.3.0',targetCity:'BD01',Itinerary:{ID:'ABC123'},Ticketing:[{FOP_Qualifiers:{BasicFOP:{Type:'CA'}},MiscQualifiers:{Commission:{Percent:7}},PricingQualifiers:{PriceQuote:[{Record:[{Number:1,Reissue:false}]}]}}],DesignatePrinter:{Printers:{Ticket:{CountryCode:'BD'},Hardcopy:{LNIATA:'ABC123'}}},PostProcessing:{EndTransaction:{Source:{ReceivedFrom:'BD01 WEB'}}}}});
 expect(safe).toMatchObject({AirTicketRQ:{version:'1.3.0',targetCity:'BD01',Itinerary:{ID:'[REDACTED]'},Ticketing:[{FOP_Qualifiers:{BasicFOP:{Type:'CA'}},MiscQualifiers:{Commission:{Percent:7}},PricingQualifiers:{PriceQuote:[{Record:[{Number:1,Reissue:false}]}]}}],DesignatePrinter:{Printers:{Hardcopy:{LNIATA:'[REDACTED]'}}}}});
 expect(JSON.stringify(safe)).not.toMatch(/ABC123|unknown field/);
 expect(JSON.stringify(redactTrace(source))).not.toMatch(/Private Passenger/);
});
