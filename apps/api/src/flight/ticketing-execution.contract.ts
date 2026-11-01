/** Shared by approved admin quotes and the supplier client. No fare overrides. */
export interface TicketingExecutionOptions { quoteHandling: 'Quit' | 'Reprice'; commitWaitMs: number; ticketingApi?:'BOOKING_MANAGEMENT'|'ENHANCED_AIR_TICKET'; commissionPercent?:number }
export const defaultTicketingExecution: Readonly<TicketingExecutionOptions> = Object.freeze({quoteHandling:'Quit',commitWaitMs:3000});
export function ticketingExecutionOptions(input?: unknown): TicketingExecutionOptions {
  if(input===undefined)return {...defaultTicketingExecution};
  if(!input||typeof input!=='object'||Array.isArray(input))throw Error('Invalid ticket issuance options.');
  const value=input as Record<string,unknown>;
  if(Object.keys(value).some(key=>!['quoteHandling','commitWaitMs','ticketingApi','commissionPercent'].includes(key))||!['Quit','Reprice'].includes(String(value.quoteHandling))||!Number.isInteger(value.commitWaitMs)||Number(value.commitWaitMs)<0||Number(value.commitWaitMs)>10000)throw Error('Use stored-fare stop or approved repricing, and a commit wait between 0 and 10000 ms.');
  if(value.ticketingApi!==undefined&&!['BOOKING_MANAGEMENT','ENHANCED_AIR_TICKET'].includes(String(value.ticketingApi)))throw Error('Select a supported ticketing API.');
  if(value.ticketingApi==='ENHANCED_AIR_TICKET'&&value.commitWaitMs!==0)throw Error('Enhanced Air Ticket requires zero Booking Management commit wait.');
  if(value.commissionPercent!==undefined&&(value.ticketingApi!=='ENHANCED_AIR_TICKET'||!Number.isInteger(value.commissionPercent)||Number(value.commissionPercent)<0||Number(value.commissionPercent)>100))throw Error('Commission must be an explicitly approved whole percentage from 0 to 100 for Enhanced Air Ticket.');
  return {quoteHandling:value.quoteHandling as 'Quit'|'Reprice',commitWaitMs:Number(value.commitWaitMs),...(value.ticketingApi?{ticketingApi:value.ticketingApi as TicketingExecutionOptions['ticketingApi']} : {}),...(value.commissionPercent!==undefined?{commissionPercent:Number(value.commissionPercent)}:{})};
}
export const ticketingApi=(options?:TicketingExecutionOptions)=>options?.ticketingApi??'BOOKING_MANAGEMENT';
export function sameTicketingExecution(a:TicketingExecutionOptions|undefined,b:TicketingExecutionOptions|undefined){return !!a&&!!b&&a.quoteHandling===b.quoteHandling&&a.commitWaitMs===b.commitWaitMs&&ticketingApi(a)===ticketingApi(b)&&a.commissionPercent===b.commissionPercent;}

/** A matching ticket number alone cannot establish the accepted price after repricing. */
export function ticketingPaymentEvidence(raw: unknown, expected: {currency:string;amount:string;ticketNumbers:string[]}): boolean {
  const tickets=(raw as {tickets?:unknown}|null)?.tickets;
  if(!Array.isArray(tickets)||!expected.ticketNumbers.length||tickets.length!==expected.ticketNumbers.length||new Set(expected.ticketNumbers).size!==expected.ticketNumbers.length)return false;
  const amounts=(value:unknown):bigint|null=>{
    if(typeof value!=='string'||!/^\d{1,9}(?:\.\d{1,2})?$/.test(value))return null;
    const [whole,fraction='']=value.split('.');return BigInt(whole!)*100n+BigInt(fraction.padEnd(2,'0'));
  };
  const required=amounts(expected.amount);if(required===null)return false;
  const seen=new Set<string>();let total=0n;
  for(const ticket of tickets){
    if(!ticket||typeof ticket.number!=='string'||!expected.ticketNumbers.includes(ticket.number)||seen.has(ticket.number)||ticket.payment?.currencyCode!==expected.currency)return false;
    const amount=amounts(ticket.payment?.total);if(amount===null)return false;
    seen.add(ticket.number);total+=amount;
  }
  return total===required;
}
