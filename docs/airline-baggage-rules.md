# Airline baggage conditions

## Connected on 11 October 2026

The existing server-side Sabre ATPCO GetAncillaryOffersRQ 3.2.0 adapter now retains:

- Offer-level `AncillaryRules.FeeApplicationMethod`, `FeeNotGuaranteeIndicator` and `RefundableReissuable`.
- Definition-level `BaggageWeightLimit.Weight` (KILO/POUND) and `LimitType` (U/O).
- Requested `Offers.Quantity` and ancillary `ServiceType`.

These fields follow the official WSDL/XSD ZIP and response design document downloaded from [Sabre's 3.2.0 resources page](https://developer.sabre.com/soap-api/get-ancillary-offers-for-travel-agencies/3.2.0/resources.html). Local downloaded schemas are under `artifacts/ancillary-schema` for inspection; they are not runtime dependencies.

Checkout displays the returned conditions. Selections retain a server-owned rules snapshot; changed rules require review on refresh. Allowances and embargo entries cannot be selected as purchasable extras. Weight-based rates require a separately confirmed weight quote, are excluded from estimated totals, and cannot be submitted through the single-item purchase path. Fixed item mappings remain available subject to existing purchase gates.

For multi-unit offers, use the supplier's `TotalTTL_Price`. A missing aggregate price is unknown, not the unit amount multiplied locally.

## Read-only CERT observations

Evidence: `artifacts/baggage-rules/airline-coverage.json`. Run `node scripts/check-airline-baggage-rules.mjs` while the local API runs. This performs three searches and up to six discovery calls; no booking or payment endpoints. Ordinary API rate limits apply.

| Airline | Route / departure | Returned baggage-related services | Observation |
| --- | --- | --- | --- |
| Biman (BG) | DAC–CXB / 24 Oct 2026 | 7 | PER KG BAGGAGE at BDT 150; no weight band for this service. A separate prepaid 10 kg bag is returned. |
| US-Bangla (BS) | DAC–CXB / 24 Oct; DAC–BKK / 5 Nov 2026 | 0 on both | No ancillary offers returned for these particular quotes. This does not establish that the airline sells no extras. |
| Thai (TG) | DAC–BKK / 5 Nov 2026 | 4 | Weight system charge explicitly priced per 1 kg over included allowance. |
| Ethiopian (ET) | KUL–SIN / 5 Nov 2026 | 39 | Mixed item and weight-related services, with weight bands on many individual services. |
| Batik Air Malaysia (OD) | KUL–SIN / 5 Nov 2026 | 10 | Item-priced services and weight bands; no explicitly per-kg fee method in the returned offers. |

## Remaining before variable-kg purchase

No verified maximum purchasable extra-kg quantity was established by these calls. A service's weight band is not that maximum. `BaggageAllowance.MaxWeight` describes an allowance; `Quantity` describes requested service units; neither supplies a remaining extra-weight cap.

Variable-kg checkout still requires a documented carrier/supplier contract to request and reprice a desired quantity, confirm the permitted extra-weight ceiling for the itinerary and passenger, carry the confirmed quantity through airline addition, and reconcile the resulting service/document evidence. Do not infer that ceiling from the commercial name, free allowance, another baggage product, or available inventory.

The NDC response adapter remains unchanged: the inspected ATPCO XML fields must not be guessed into a different JSON contract. CERT observations do not certify production availability or fulfillment.
