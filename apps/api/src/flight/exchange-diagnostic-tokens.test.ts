import {it,expect} from 'vitest';
import {exchangeMessageTokens,validateExchangeMessageTokens} from './exchange-diagnostic-tokens.js';
import {enhancedTicketDiagnostics} from './enhanced-air-ticket.contract.js';
import {sanitizedTicketingErrors} from './ticketing-currency.contract.js';
it('keeps partial technical reasons while removing known names, locator, ticket, email and grouped card data',()=>{
 const input='AutomatedExchangesLLSRQ: CLASS NOT AVAILABLE for Class Testperson PNR ABC123 ticket 9971234567890 email@example.com 4242 4242 4242 4242 CAT 31 REQUIRED';
 const tokens=exchangeMessageTokens(input,['Class','Testperson','ABC123','9971234567890']);
 expect(tokens).toContain('REQUIRED');expect(tokens).toContain('AVAILABLE');expect(tokens).toContain('31');
 expect(tokens.join(' ')).not.toMatch(/TESTPERSON|ABC123|9971234567890|4242|EMAIL|EXAMPLE/);
 expect(tokens).toContain('[REDACTED]');
});
it('rejects credential-bearing text and unrecognized stored tokens',()=>{
 expect(exchangeMessageTokens('CLASS NOT AVAILABLE',[undefined as unknown as string])).toContain('AVAILABLE');
 expect(exchangeMessageTokens('password secret WFRF NOT AVAILABLE',[])).toEqual(['[REDACTED]']);
 expect(validateExchangeMessageTokens(['WFRF','PrivateName','123456','NOT'])).toEqual(['WFRF','[REDACTED]','[REDACTED]','NOT']);
});
it('retains a bounded redacted token view through repeated diagnostic normalization',()=>{
 const raw={AirTicketRS:{ApplicationResults:{status:'Incomplete',Error:[{SystemSpecificResults:[{Message:[{code:'ERR.SP.PROVIDER_ERROR',content:'AutomatedExchangesLLSRQ: MANUAL EXCHANGE ONLY - PrivateName ABC123'}]}]}]}}};
 const first=enhancedTicketDiagnostics(raw,['PrivateName','ABC123']).errors;
 expect(first[0]?.messageTokens).toContain('MANUAL');expect(first[0]?.providerMessageCodes).toEqual(['ERR.SP.PROVIDER_ERROR']);
 const second=sanitizedTicketingErrors(first);expect(second[0]?.messageTokens).toEqual(first[0]?.messageTokens);
 expect(JSON.stringify(second)).not.toMatch(/PrivateName|ABC123/);
 expect(exchangeMessageTokens('UNKNOWN '.repeat(1000),[]).length).toBeLessThanOrEqual(120);
});
