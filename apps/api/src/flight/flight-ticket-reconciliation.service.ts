import type {TicketDocumentContext,TicketReconciliation,TicketReconciliationExpected} from './ticketing-reconciliation.contract.js';
import {verifyTicketDocuments} from './ticketing-reconciliation.contract.js';

/** The port exposes retrieval only; this service cannot dispatch any supplier mutation. */
export interface ReadonlyTicketDocumentProvider {getIssuedTicketContext(pnr:string):Promise<TicketDocumentContext>}
export class FlightTicketReconciliationService {
 constructor(private readonly provider:ReadonlyTicketDocumentProvider|undefined,
  private readonly wait:(milliseconds:number)=>Promise<void>=milliseconds=>new Promise(resolve=>setTimeout(resolve,milliseconds))){}
 /** Bounded document visibility checks. Only an empty, complete lookup is polled;
  * mismatched, partial or unavailable evidence goes straight to staff review. */
 async recover(expected:TicketReconciliationExpected):Promise<TicketReconciliation>{
  const checks:NonNullable<TicketReconciliation['recovery']>['checks']=[];
  for(const delay of [0,1500,3000]){
   if(delay)await this.wait(delay);
   const result=await this.inspect(expected);
   checks.push({verification:result.verification,checkedAt:result.checkedAt,documentCount:result.documentCount,supplierRequestId:result.supplierRequestId});
   if(result.verification!=='NO_TICKETS_REPORTED'||checks.length===3)return {...result,recovery:{lookupCount:checks.length,checks}};
  }
  throw Error('Unreachable document recovery state');
 }
 async inspect(expected:TicketReconciliationExpected):Promise<TicketReconciliation>{
  try{
   if(!this.provider)throw Error('No read-only provider');
   const context=await this.provider.getIssuedTicketContext(expected.pnr);
   return verifyTicketDocuments(context,expected,new Date().toISOString());
  }catch{
   // No free-form exception messages: transport and parsing errors can echo secrets.
   return {verification:'LOOKUP_UNAVAILABLE',checkedAt:new Date().toISOString(),documentCount:0,pccScope:'PCC_NOT_CONFIRMED',reasons:['SUPPLIER_DOCUMENT_LOOKUP_UNAVAILABLE'],automaticRetry:false};
  }
 }
}
