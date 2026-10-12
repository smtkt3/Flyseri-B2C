import type { FlightAncillaryRules } from '@flyseri/types';

const methods: Record<string, string> = {
  PER_1KG_OVER_FREE_BAGGAGE_ALLOWANCE: 'Per 1 kg above your included allowance',
  PER_5KG_OVER_FREE_BAGGAGE_ALLOWANCE: 'Per 5 kg above your included allowance',
  '0.5%_OF_FARE_PER_KG': '0.5% of the applicable fare per kg',
  '1%_OF_FARE_PER_KG': '1% of the applicable fare per kg',
  '1.5%_OF_FARE_PER_KG': '1.5% of the applicable fare per kg',
  ONE_WAY: 'Per one-way fare component', ROUND_TRIP: 'Round-trip fee basis',
  ITEM: 'Per item', TRAVEL: 'Per journey', TICKET: 'Per ticket',
  PER_CHECKED_PORTION: 'Per checked portion', PER_BAGGAGE_TRAVEL: 'Per baggage journey',
};
export function airlineFeeBasis(rules?: FlightAncillaryRules) {
  return rules?.feeApplicationMethod ? methods[rules.feeApplicationMethod] ?? 'See airline fee conditions' : null;
}
export function FlightAirlineRules({ rules, baggage = false }: { rules?: FlightAncillaryRules; baggage?: boolean }) {
  const basis = airlineFeeBasis(rules);
  if (!rules && !baggage) return null;
  return <div className="flight-airline-rules" aria-label="Airline service rules">
    <strong>Airline conditions</strong>
    {basis && <p>{basis}</p>}
    {!!rules?.weightLimits.length && <ul>{rules.weightLimits.map((limit, index) => <li key={index}>Service weight band: {limit.relation === 'UP_TO' ? 'up to' : 'over'} {limit.value} {limit.unit.toLowerCase()}</li>)}</ul>}
    {!!rules?.weightLimits.length && <p>A service weight band is not an allowance to buy that many extra kilograms.</p>}
    {rules?.quotedQuantity !== null && rules?.quotedQuantity !== undefined && <p>Quantity in this quote: {rules.quotedQuantity} {rules.quotedQuantity === 1 ? 'service unit' : 'service units'}</p>}
    {rules?.feeMayChange === true && <p>The airline says this fee may change before confirmation.</p>}
    {rules?.refundabilityCode && <p>Airline refund/reissue code: {rules.refundabilityCode}. Ask Flyseri to confirm eligibility before purchase.</p>}
    {rules?.requiresWeightConfirmation && <p className="flight-airline-rules-pending">Extra weight and maximum purchasable kilograms need airline confirmation. Request assistance below for a weight quote; this rate is not a baggage total.</p>}
    {baggage && !rules?.requiresWeightConfirmation && !basis && <p>The airline did not supply a fee basis. Confirm the baggage conditions before purchase.</p>}
    {rules && ['A', 'B', 'E'].includes(rules.serviceType ?? '') && <p>This entry is an allowance or restriction and cannot be added as an extra.</p>}
  </div>;
}
