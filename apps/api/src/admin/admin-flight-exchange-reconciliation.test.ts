import {describe,it,expect,vi} from 'vitest';
import {AdminFlightExchangesService} from './admin-flight-exchanges.service.js';

describe('lost exchange reply reconciliation',()=>{
 it('refreshes current evidence and preserves the lock without another exchange, checkout or reissue',async()=>{
  const flights=[{airlineCode:'BG',flightNumber:'433',origin:'DAC',destination:'CXB',departureDate:'2026-12-10',departureTime:'08:00',arrivalDate:'2026-12-10',arrivalTime:'09:00',status:'Confirmed'}];
  const view={flights,travellers:[{givenName:'Synthetic',surname:'Test'}],tickets:[{number:'9971234567890',status:'Issued',travellerIndex:1}],cancellationCheckComplete:true};
  const before={bookingId:'ABC123',view,travelers:[{nameAssociationId:1,givenName:'Synthetic',surname:'Test'}],tickets:[{number:'9971234567890',travelerIndex:1}],pqrRecords:[]};
  const state={stage:'EXCHANGE_COMMITTING',exchangeBefore:before,exchangeOffer:{flights:[{...flights[0],airline:'BG',number:'437',departureDate:'2026-12-11'}]}};
  const writes:unknown[]=[];
  const tx={update:vi.fn(()=>({set:(value:unknown)=>{writes.push(value);return {where:()=>({returning:async()=>[{id:'case-1'}]})};}})),insert:vi.fn(()=>({values:vi.fn(async()=>undefined)}))};
  const db={transaction:vi.fn(async(fn:(value:typeof tx)=>Promise<void>)=>fn(tx))};
  const supplier={getExchangeContext:vi.fn(async()=>({...before,view:{...view,flights:flights.map(flight=>({...flight,departureTime:flight.departureTime+':00',arrivalTime:flight.arrivalTime+':00'}))}})),exchangeBooking:vi.fn(),fulfillExchange:vi.fn()};
  const service=new AdminFlightExchangesService({db} as never,{} as never,supplier as never,{} as never);
  vi.spyOn(service as any,'load').mockResolvedValue({record:{status:'OUTCOME_UNKNOWN',version:6},booking:{id:'booking-1',pnrLocator:'ABC123'},state});
  await service.reconcile('case-1',{action:'RECONCILE',version:6,confirmedPnr:'ABC123'},{role:'manager',staffUserId:'staff'} as never);
  expect(supplier.getExchangeContext).toHaveBeenCalledExactlyOnceWith('ABC123',before);
  expect(supplier.exchangeBooking).not.toHaveBeenCalled();expect(supplier.fulfillExchange).not.toHaveBeenCalled();
  expect(writes).toMatchObject([{status:'OUTCOME_UNKNOWN',version:7,result:{stage:'EXCHANGE_COMMITTING',exchangeReconciliation:{originalFlightsMatch:true,approvedItineraryMatches:false,activePqrCount:0,automaticRetry:false,supplierMutationRepeated:false}}}]);
  expect(tx.update).toHaveBeenCalledOnce();expect(tx.insert).toHaveBeenCalledOnce();
 });
});
