import {it,expect} from 'vitest';
import {flightTicketPayload} from './ticketing-reconciliation.contract.js';
it('separates only explicitly identified EMDs without hiding unknown or malformed documents',()=>{
 const raw={travelers:[{ancillaries:[{electronicMiscellaneousDocumentNumber:'9971234567890'}]}],flightTickets:[{number:'9971234567891'},{number:'9971234567890'},{number:'unknown'},null]};
 const flight=flightTicketPayload(raw) as typeof raw;
 expect(flight.flightTickets).toEqual([{number:'9971234567891'},{number:'unknown'},null]);expect(raw.flightTickets).toHaveLength(4);
 expect(flightTicketPayload({flightTickets:[{number:'9971234567890'}]})).toEqual({flightTickets:[{number:'9971234567890'}]});
});
