# Get Ancillaries Airline 3.0: integration assessment

Source: user-supplied overview retained on 4 October 2026 in [the original text](Get_Ancillaries_Airline_3_0_user_overview.txt).

## What this adds

The supplied guide describes ATPCO and Sabre product catalog discovery using reservation payloads or a PNR locator. Responses can include service names, prices, taxes and inventory; returned offers are stored temporarily for subsequent booking. Booking is a separate operation through Manage Ancillary 1.1. The guide explicitly identifies the API as intended for airline carriers and points agencies to Get Ancillaries Agency 2.3 for NDC.

Account access to the airline API has not been established. The overview supplies operation names, but no complete request/response schema or full versioned CERT endpoint URLs. It cannot be used to manufacture service prices, product identifiers or booking confirmations.

## Agency-compatible references already present

The 2023.02 and 2026.08 collections include SOAP `GetAncillaryOffersRQ 3.1.0` examples for agency ATPCO workflows. The 2023.02 collection also has CreateBooking examples titled `Ancillaries baggage` and `Ancillaries baggage with SSR`. These are a separate integration from Airline REST 3.0 and need their own schema and account validation.

The January 2025 NDC agency collection includes:

- `5. Offers GetAncillaries /v2`: `/v2/offers/getAncillaries`.
- `7. Orders Change /v1 Add Ancillaries`: `/v1/orders/change`, using the real supplier order ID, offer item ID and passenger reference.
- Offer pricing and order fulfillment examples.

These selected collection requests contain no saved response examples. They document request patterns, but do not establish account authorization, service availability or completed fulfillment.

## Application state

- Per-traveller service preferences are persisted in `flight_booking_intents.service_requests`. These are requests for staff review, not airline-confirmed SSRs, sold products or EMDs.
- Existing agency NDC lookup uses the selected server-owned shopping offer. It returns informational services and does not purchase them.
- Current reservation checkout handles adult ATPCO PNRs; NDC orders and priced NDC ancillary contexts are not yet connected to checkout.
- There is no verified ATPCO ancillary discovery/booking response or enabled EMD fulfillment for this application.

## Needed for a complete purchase connection

1. Agency ATPCO discovery and booking contracts (including SOAP response schemas), or explicit airline API entitlement with Airline 3.0 and Manage Ancillary 1.1 OpenAPI contracts.
2. For NDC: Offer Price, Order View/Change and fulfillment response contracts, with an available authorized NDC offer/order on this CERT account.
3. Authoritative passenger/segment references, service prices/currency/taxes, inventory, expiry and supplier status mappings.
4. Durable ancillary selections, accepted-price records, payment and supplier reconciliation, plus approved non-cash ticket/EMD settlement configuration.

Availability must be determined from the chosen fare and live provider response. Airline names alone must not determine meal inclusion, baggage packages or prices.
