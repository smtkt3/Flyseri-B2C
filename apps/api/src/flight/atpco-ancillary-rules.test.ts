import { describe, expect, it } from 'vitest';
import type { FlightOffer } from '@flyseri/types';
import { readAtpcoRules } from './atpco-ancillary-rules.js';
import { readAtpcoAncillaries } from './sabre-atpco-ancillaries.client.js';

const offer = { outbound: { segments: [{ origin: 'DAC', destination: 'CXB', marketingCarrier: 'BG', flightNumber: '535' }] }, inbound: null } as unknown as FlightOffer;
function xml(quantity = '1', aggregate = '', method = 'PER_1KG_OVER_FREE_BAGGAGE_ALLOWANCE', name = 'PER KG BAGGAGE') {
  return `<Envelope><Body><GetAncillaryOffersRS><ApplicationResults status="Complete"/><OfferId>offer</OfferId>
  <AncillaryDefinition id="definition"><SubCode>0AA</SubCode><CommercialName>${name}</CommercialName><Group>BG</Group><Airline>BG</Airline><ReasonForIssuance>BAGGAGE</ReasonForIssuance><ElectronicMiscDocType>FLIGHT_COUPON_ASSOCIATED</ElectronicMiscDocType><BaggageWeightLimit><Weight unit="KILO">23</Weight><LimitType>U</LimitType></BaggageWeightLimit></AncillaryDefinition>
  <Ancillary ancillaryId="ancillary" ancillaryDefinitionRef="definition"><ServiceType>C</ServiceType></Ancillary>
  <Offers offerId="one" ancillaryRef="ancillary"><Quantity>${quantity}</Quantity><Segment segmentId="seg_1"/><AncillaryRules><FeeApplicationMethod code="K">${method}</FeeApplicationMethod><FeeNotGuaranteeIndicator>true</FeeNotGuaranteeIndicator></AncillaryRules><AncillaryFee><Base><Amount currency="BDT">150.00</Amount></Base><TTL_Price><Amount currency="BDT">150.00</Amount></TTL_Price>${aggregate}</AncillaryFee></Offers>
  <PassengerOffers><PassengerReference passengerId="p1"/><OfferRefs>one</OfferRefs></PassengerOffers>
  </GetAncillaryOffersRS></Body></Envelope>`;
}
describe('supplier baggage conditions', () => {
  it('retains fee units, weight bands and requested quantity without inventing a purchase cap', () => {
    const options: Parameters<typeof readAtpcoAncillaries>[3] = [];
    const service = readAtpcoAncillaries(xml(), offer, 1, options).services[0]!;
    expect(service.rules).toMatchObject({ source: 'SABRE_ATPCO', feeApplicationMethod: 'PER_1KG_OVER_FREE_BAGGAGE_ALLOWANCE', weightLimits: [{ value: 23, unit: 'KG', relation: 'UP_TO' }], quotedQuantity: 1, feeMayChange: true, serviceType: 'C', requiresWeightConfirmation: true });
    expect(service.rules).not.toHaveProperty('maximumKg');
    expect(options).toEqual([null]);
  });
  it('never uses a per-unit price as the total of a multi-unit offer', () => {
    expect(readAtpcoAncillaries(xml('5'), offer, 1).services[0]!.amount).toBeNull();
    expect(readAtpcoAncillaries(xml('5', '<TotalTTL_Price><Amount currency="BDT">700.00</Amount></TotalTTL_Price>'), offer, 1).services[0]!.amount).toBe('700.00');
  });
  it('keeps fixed item purchase mapping available', () => {
    const options: Parameters<typeof readAtpcoAncillaries>[3] = [];
    readAtpcoAncillaries(xml('1', '', 'ITEM', 'EXTRA BAG'), offer, 1, options);
    expect(options[0]?.totals.total).toBe('150.00');
  });
  it('does not infer kilograms or a max from a commercial name or requested quantity', () => {
    const rules = readAtpcoRules({ CommercialName: 'PER KG BAGGAGE' }, {}, { Quantity: '30' });
    expect(rules.requiresWeightConfirmation).toBe(true);
    expect(rules.feeApplicationMethod).toBeNull();
    expect(rules.weightLimits).toEqual([]);
    expect(rules.quotedQuantity).toBe(30);
  });
  it('ignores malformed bands and preserves pounds without converting them to kg', () => {
    const rules = readAtpcoRules({ BaggageWeightLimit: [
      { Weight: { '#text': '50', '@_unit': 'POUND' }, LimitType: 'U' },
      { Weight: { '#text': '-5', '@_unit': 'KILO' }, LimitType: 'U' },
      { Weight: { '#text': '32', '@_unit': 'KG' }, LimitType: 'U' },
      { Weight: { '#text': '32', '@_unit': 'KILO' }, LimitType: 'UNKNOWN' },
    ] }, {}, {});
    expect(rules.weightLimits).toEqual([{ value: 50, unit: 'LB', relation: 'UP_TO' }]);
    expect(rules.feeMayChange).toBeNull();
  });
});
