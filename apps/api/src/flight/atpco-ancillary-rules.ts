import type { FlightAncillaryRules } from '@flyseri/types';

type Node = Record<string, unknown>;
const object = (value: unknown): Node => value && typeof value === 'object' && !Array.isArray(value) ? value as Node : {};
const text = (value: unknown): string => typeof value === 'string' ? value : typeof object(value)['#text'] === 'string' ? object(value)['#text'] as string : '';
const bounded = (value: unknown, max = 80) => { const result = text(value).trim(); return result && result.length <= max && !/[\x00-\x1f\x7f]/.test(result) ? result : null; };

/** GetAncillaryOffersRQRS 3.2.0: Products_v3_02 BaggageWeightLimit and
 * AncillaryRules; Ancillary_v3_2_0 Offers.Quantity is requested quantity,
 * never available inventory or a maximum. No limits are inferred from names. */
export function readAtpcoRules(definition: Node, ancillary: Node, offer: Node): FlightAncillaryRules {
  const rules = object(offer.AncillaryRules);
  const feeApplicationMethod = bounded(rules.FeeApplicationMethod);
  const limits = definition.BaggageWeightLimit;
  const weightLimits: FlightAncillaryRules['weightLimits'] = [];
  for (const entry of (Array.isArray(limits) ? limits : limits ? [limits] : []).slice(0, 20)) {
    const limit = object(entry), weight = object(limit.Weight);
    const raw = text(limit.Weight), unit = text(weight['@_unit']), relation = text(limit.LimitType);
    if (!/^[1-9]\d{0,4}$/.test(raw) || !['KILO', 'POUND'].includes(unit) || !['U', 'O'].includes(relation)) continue;
    weightLimits.push({ value: Number(raw), unit: unit === 'KILO' ? 'KG' : 'LB', relation: relation === 'U' ? 'UP_TO' : 'OVER' });
  }
  const quantity = text(offer.Quantity), feeChange = text(rules.FeeNotGuaranteeIndicator);
  const method = feeApplicationMethod ?? '';
  // The commercial name may identify a weight-priced service when the carrier
  // omits the fee method. It cannot establish a unit price or an approved cap.
  const weightNamed = /\bPER\s+(?:KG|KILO(?:GRAM)?)\b/i.test(text(definition.CommercialName));
  return {
    source: 'SABRE_ATPCO', feeApplicationMethod, weightLimits,
    quotedQuantity: /^[1-9]\d{0,4}$/.test(quantity) ? Number(quantity) : null,
    feeMayChange: feeChange === 'true' ? true : feeChange === 'false' ? false : null,
    refundabilityCode: bounded(rules.RefundableReissuable, 10),
    serviceType: bounded(ancillary.ServiceType, 10),
    requiresWeightConfirmation: /(?:PER_\d+KG_OVER_FREE_BAGGAGE_ALLOWANCE|OF_FARE_PER_KG)/.test(method) || weightNamed,
  };
}
