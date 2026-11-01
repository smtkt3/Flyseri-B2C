import { describe, expect, it } from 'vitest';
import { buildGetPriceQuoteRequest, readPriceQuoteEvidence, readPricingInstruction } from './sabre-price-quote.contract.js';

const response = () => ({
  Header: { Results: { Success: '' }, '@_messageID': 'supplier-trace-1', '@_timeStamp': '2026-10-21T04:56:00' },
  PriceQuoteInfo: {
    Reservation: { '#text': 'ABC123', '@_updateToken': 'private-update-token' },
    Details: {
      '@_number': '1', '@_type': 'PQ', '@_status': 'A', '@_pricingType': 'S',
      AgentInfo: { HomeLocation: 'BD01', WorkLocation: 'BD01' },
      TransactionInfo: { InputEntry: 'WPMBDT', LocalCreateDateTime: '2026-10-21T10:51:00' },
      FareInfo: { BaseFare: { '#text': '167.44', '@_currencyCode': 'USD' }, EquivalentFare: { '#text': '20686', '@_currencyCode': 'BDT' }, TotalFare: { '#text': '24141', '@_currencyCode': 'BDT' } },
      MiscellaneousInfo: { ValidatingCarrier: 'AA' },
      PaymentInfo: { cardNumber: '4111111111111111' }, NameAssociationInfo: { firstName: 'PrivateName' },
    },
  },
});

describe('read-only stored price quote contract', () => {
  it('uses the XSD Type element and stateless active-PQ request', () => {
    const xml = buildGetPriceQuoteRequest('ABC123');
    expect(xml).toContain('<Status>A</Status><Type>PQ</Type><PriceQuote/>');
    expect(xml).toContain('stateful="false"');
    expect(xml).not.toMatch(/Update|Retain|PriceQuote type=/);
    expect(() => buildGetPriceQuoteRequest('ABC<12')).toThrow();
  });
  it.each(['WPMBDT', 'WP¥MBDT', 'WP‡MBDT', 'WP$MBDT'])('recognizes a specific-currency instruction: %s', entry => {
    expect(readPricingInstruction(entry).currencyQualifiers).toEqual([{ type: 'SPECIFIC_CURRENCY', currency: 'BDT' }]);
  });
  it('separates alternate-currency instructions from ordinary currency text', () => {
    expect(readPricingInstruction('WPD*USD').currencyQualifiers).toEqual([{ type: 'ALTERNATE_CURRENCY', currency: 'USD' }]);
    expect(readPricingInstruction('WP¥MBDTX').currencyInstruction).toBe('NOT_ESTABLISHED');
    expect(readPricingInstruction('BDT payable').currencyInstruction).toBe('NOT_ESTABLISHED');
    expect(readPricingInstruction(undefined).inputEntryPresent).toBe(false);
  });
  it('recognizes only exact native WP/WPRQ instructions as native pricing', () => {
    expect(readPricingInstruction('WPRQ').currencyInstruction).toBe('NATIVE_PRICING_ENTRY');
    expect(readPricingInstruction('WP').currencyInstruction).toBe('NATIVE_PRICING_ENTRY');
    expect(readPricingInstruction('WP unknown').currencyInstruction).toBe('NOT_ESTABLISHED');
  });
  it('keeps USD base and BDT payable amounts distinct and excludes sensitive fields', () => {
    const result = readPriceQuoteEvidence(response(), 'ABC123');
    expect(result.details[0]).toMatchObject({ number: '1', status: 'A', pricingType: 'S', base: { currency: 'USD' }, total: { currency: 'BDT' }, currencyInstruction: 'EXPLICIT_CURRENCY_FOUND' });
    expect(JSON.stringify(result)).not.toMatch(/private-update-token|4111111111111111|PrivateName|WPMBDT/);
  });
  it('rejects another reservation and duplicate quote identities', () => {
    expect(() => readPriceQuoteEvidence(response(), 'DEF456')).toThrow(/mismatch/);
    const raw = response();
    expect(() => readPriceQuoteEvidence({ ...raw, PriceQuoteInfo: { ...raw.PriceQuoteInfo, Details: [raw.PriceQuoteInfo.Details, raw.PriceQuoteInfo.Details] } }, 'ABC123')).toThrow(/Duplicate/);
  });
  it.each(['Error', 'Warning'])('rejects partial responses containing %s', type => {
    const raw = response();
    expect(() => readPriceQuoteEvidence({ ...raw, Header: { Results: { Success: '', [type]: '' } } }, 'ABC123')).toThrow(/incomplete/);
  });
  it('does not accept inactive or absent quote details as evidence', () => {
    const raw = response(); raw.PriceQuoteInfo.Details['@_status'] = 'I';
    expect(() => readPriceQuoteEvidence(raw, 'ABC123')).toThrow(/identity/);
    expect(() => readPriceQuoteEvidence({ ...raw, PriceQuoteInfo: { Reservation: 'ABC123' } }, 'ABC123')).toThrow(/unavailable/);
  });
});
