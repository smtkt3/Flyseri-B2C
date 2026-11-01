import {describe,it,expect} from 'vitest';
import {ticketingExecutionOptions,ticketingPaymentEvidence} from './ticketing-execution.contract.js';

describe('approved ticket execution policy',()=>{
  it('defaults to stored-fare stop with a documented commit wait',()=>{
    expect(ticketingExecutionOptions()).toEqual({quoteHandling:'Quit',commitWaitMs:3000});
    expect(ticketingExecutionOptions({quoteHandling:'Reprice',commitWaitMs:10000})).toEqual({quoteHandling:'Reprice',commitWaitMs:10000});
  });
  it.each([null,[],{}, {quoteHandling:'Override',commitWaitMs:3000},{quoteHandling:'Reprice',commitWaitMs:-1},{quoteHandling:'Quit',commitWaitMs:10001},{quoteHandling:'Quit',commitWaitMs:1.5},{quoteHandling:'Quit',commitWaitMs:'3000'},{quoteHandling:'Quit',commitWaitMs:3000,acceptPriceChanges:true}])('rejects unsupported policy %j',value=>expect(()=>ticketingExecutionOptions(value)).toThrow());
});
describe('issued document price evidence',()=>{
  const expected={currency:'BDT',amount:'6049.00',ticketNumbers:['9971234567890']};
  const ticket={number:'9971234567890',payment:{total:'6049',currencyCode:'BDT'}};
  it('matches exact ticket identities, currency and aggregate price',()=>{
    expect(ticketingPaymentEvidence({tickets:[ticket]},expected)).toBe(true);
    expect(ticketingPaymentEvidence({tickets:[{...ticket,payment:{total:'3024.50',currencyCode:'BDT'}},{number:'9971234567891',payment:{total:'3024.50',currencyCode:'BDT'}}]},{...expected,ticketNumbers:[ticket.number,'9971234567891']})).toBe(true);
  });
  it.each([undefined,{}, {tickets:[]},{tickets:[{...ticket,payment:{total:'6050',currencyCode:'BDT'}}]},{tickets:[{...ticket,payment:{total:'6049',currencyCode:'USD'}}]},{tickets:[{number:ticket.number}]},{tickets:[{...ticket,number:'9979999999999'}]},{tickets:[ticket,ticket]},{tickets:[{...ticket,payment:{total:6049,currencyCode:'BDT'}}]}])('retains document review when evidence is missing or differs %j',raw=>expect(ticketingPaymentEvidence(raw,expected)).toBe(false));
});
