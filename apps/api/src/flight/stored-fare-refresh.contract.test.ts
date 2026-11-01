import {expect,it} from 'vitest';
import {buildStoredFarePriceRequest,verifyStoredFarePrice} from './stored-fare-refresh.contract.js';
it('computes without retaining by default and never requests rebooking, backdating or currency overrides',()=>{
 expect(buildStoredFarePriceRequest('BG')).toContain('Retain="false"');
 expect(buildStoredFarePriceRequest('BG',true)).toContain('Retain="true"');
 expect(buildStoredFarePriceRequest('BG',true)).not.toMatch(/BargainFinder|Rebook|AlternateCurrency|BackDate|AirTicket|EndTransaction/);
 expect(()=>buildStoredFarePriceRequest('BG" injected')).toThrow();
});
it('requires one complete quote at the exact paid amount and currency before any commit',()=>{
 const raw=(amount:string,currency='BDT')=>({ApplicationResults:{'@_status':'Complete'},PriceQuote:{TotalFare:{'@_Amount':amount,'@_CurrencyCode':currency}}});
 expect(verifyStoredFarePrice(raw('6349'),{amount:'6349.00',currency:'BDT'})).toEqual({amount:'6349.00',currency:'BDT'});
 for(const body of [raw('6350'),raw('6300'),raw('6349','USD'),{...raw('6349'),ApplicationResults:{'@_status':'Incomplete'}},{...raw('6349'),Other:{TotalFare:{'@_Amount':'6349','@_CurrencyCode':'BDT'}}}])expect(()=>verifyStoredFarePrice(body,{amount:'6349.00',currency:'BDT'})).toThrow();
});
