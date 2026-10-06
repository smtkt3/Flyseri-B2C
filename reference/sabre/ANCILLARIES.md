# Ancillary offers

Current user-supplied version 2.3 behavior and purchase prerequisites are retained in [GET_ANCILLARIES_AGENCY_2_3.md](GET_ANCILLARIES_AGENCY_2_3.md). BFM-stage services can omit item IDs and are display-only; the parser now supports this. This API does not support ATPCO or LCC extras.

The requested CERT offers API uses `POST https://api.cert.platform.sabre.com/v2/offers/getAncillaries` for ancillary retrieval.

The server client supports the four NDC variants supplied by the user on 2026-10-03:

- Offer ID after Air Shopping, with real passenger references and names.
- Offer ID after Offer Price, with real passenger references and names.
- Order ID.
- Order ID with `requestedSegmentRefs` and `requestedPaxRefs`.

The offer-ID request is:

```json
{
  "requestType": "offerId",
  "request": {
    "offerId": "<Sabre NDC offer ID from shopping or pricing>",
    "passengers": [{
      "passengerId": "<passenger reference for this offer>",
      "passengerTypeCode": "ADT",
      "givenName": "<actual given name>",
      "surname": "<actual surname>"
    }]
  }
}
```

The order-ID request also appears in the supplied `Booking_Management_API_v2_2026.08.postman_collection.json`, under `ModifyBookingAPI / NDC / Modify ancillaries / GetAncillaryOffersRQ`:

```json
{
  "requestType": "orderId",
  "request": { "orderId": "<confirmed Sabre NDC order ID>" }
}
```

OAuth authentication stays on the server. Retrieval does not add services, take payment, or issue an EMD.

## Implemented lookup and display

- BFM requests NDC and ATPCO content. Its mapper accepts `NDC_CONNECTOR` fares and retains `offer.offerId`, the supplier TTL, and passenger references resolved through `passengerDescs`.
- Supplier context is preserved separately from the app's local offer UUID through cache/session validation. Supplier expiry is checked before ancillary retrieval.
- `POST /api/v1/flights/ancillaries` resolves the selected offer from its guest/customer search session. The request takes local search/offer UUIDs and actual passenger names; arbitrary supplier offer IDs are not accepted.
- Checkout offers **Check additional services** for NDC fares with passenger references, after passenger details are confirmed. Changing passenger details clears the previous result.
- The public parser resolves `ancillaries.offer.otherServices` through `serviceDefinitions`, `segments`, and passenger references. It displays the commercial name (or service code), flight applicability and passenger positions. Quoted prices are read from `priceDefinitions[].serviceFee.totalPrice.saleAmount`; a missing price is shown as unspecified, never automatically free.
- The response is marked informational and has no purchase action. NDC offers are explicitly blocked from the existing ATPCO revalidation/reservation flow.
- Raw BFM response logging was removed to keep supplier passenger fields out of development logs.

The response/reference fields above were checked against the official Sabre Offers and Orders guide's indexed ancillary and NDC shopping examples. A successful live ancillary lookup has not yet been observed.

On 2026-10-03, CERT shopping requests for KUL–SIN and LHR–JFK on 2026-11-05 returned HTTP 200, with 138 and 100 fare entries respectively, but zero `NDC_CONNECTOR` offers. This does not establish whether the cause is account entitlement, airline coverage or offer availability. No ancillary offer ID was available to retrieve, and no booking or payment was attempted.

## Remaining connection requirements

- Obtain a currently available NDC fare on this CERT account to confirm a live ancillary lookup. A local offer UUID must not be sent as a Sabre NDC offer ID.
- The current customer reservation flow creates ATPCO PNRs; it does not yet create confirmed NDC orders. A PNR locator or local commerce order UUID must not be substituted for the documented Sabre order ID.
- The saved collection and the supplied request examples have no ancillary response examples. The parser follows the published response example; compare it with the account's current response once an NDC offer is available.
- The supplied version 2.3 guide requires a priced offer or confirmed NDC order for bookable identifiers. Older guide references to application-ID configuration are not established as a current activation requirement; do not invent a header or identifier.
- Customer access must resolve the confirmed supplier identifier and passenger references from the selected search session or a customer-owned booking; do not expose an arbitrary offer/order-ID proxy.

Existing shopping baggage allowances and meal benefits remain supplier-sourced fare information. They are not presented as ancillary offers from this endpoint.

Sources: the user's four current request examples (2026-10-03) for offer/order variants; supplied 2026.08 collection for the order-ID request. The older [Sabre Offers and Orders user guide](https://developer.sabre.com/sites/default/files/2024-04/Sabre%20Offers%20and%20Orders%20APIs%20user%20guide%20v1.6.pdf) was previously consulted for informational versus bookable offers; its order-ID-only limitation is superseded by the user's current examples.
