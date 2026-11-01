import {it,expect,vi} from 'vitest';
import {SabreBookingManagementClient} from './sabre-booking-management.client.js';
import type {AppConfig} from '@flyseri/config';
it('fulfills only explicit ancillary IDs without an empty flight-ticket fulfillment or PQ selection',async()=>{
 const http=vi.fn(async(_input: string | URL | Request,_options?: RequestInit)=>new Response(JSON.stringify({tickets:[{number:'9971234567890'}]}),{status:200}));
 const client=new SabreBookingManagementClient({APP_ENV:'test',SABRE_ENV:'CERT',SABRE_PCC:'TEST',SABRE_BASE_URL:'https://api.cert.platform.sabre.com',SABRE_REQUEST_TIMEOUT_MS:1000} as AppConfig,{token:async()=> 'fixture-token'} as never,http);
 await client.fulfillAncillaryDocuments('ABCDEF',{formOfPayment:'CASH',hardcopyPrinterAddress:'ABC123',ticketCountryCode:'BD'},['12','13']);
 const options=http.mock.calls[0]?.[1] as RequestInit|undefined,body=JSON.parse(String(options?.body));
 expect(body.fulfillments).toEqual([{ancillaryIds:['12','13'],payment:{primaryFormOfPayment:1}}]);expect(body).not.toHaveProperty('ticketingQualifiers');expect(body.formsOfPayment).toEqual([{type:'CASH'}]);expect(body.acceptPriceChanges).toBe(false);
 expect(http).toHaveBeenCalledTimes(1);
 await expect(client.fulfillAncillaryDocuments('ABCDEF',{formOfPayment:'CASH',hardcopyPrinterAddress:'ABC123',ticketCountryCode:'BD'},['12','12'])).rejects.toThrow();expect(http).toHaveBeenCalledTimes(1);
});
