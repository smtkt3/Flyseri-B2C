# Get Ancillaries – Agency 2.3

Source: user-supplied Sabre overview on 2026-10-03, linked to [Get Ancillaries – Agency](https://developer.sabre.com/rest-api/get-ancillaries-agency/2.3).

## Supported content and authentication

- NDC content in a stateless flow; ATPCO and LCC are not supported by this API version.
- Both free and chargeable special services may be returned, including meals, accessibility services, checked bags and carbon offsets. Some services have inventory restrictions.
- ATK and ATH tokens are supported. The application keeps its existing OAuth v3 ATK authentication server-side.

## Context determines whether the response can be booked

1. A BFM shopping offer ID can retrieve display content. Responses are `sellable: false` and may omit `offerItemId`. Such responses must still display, but cannot be submitted as an ancillary purchase.
2. An Offer Price result can supply valid bookable identifiers. Price the selected flight using actual supplier offer-item references; retain the returned offer, passenger references, prices and expiry as an owned server context.
3. A confirmed NDC order ID can retrieve bookable services. Resolve the order from the customer's booking; never substitute a PNR or Flyseri commerce-order UUID.

Get Ancillaries retrieves content. Adding and fulfilling an ancillary requires separate order operations. Sabre's [NDC collection](https://developer.sabre.com/product-collection/new-distribution-capability-ndc/v1/index.html) lists ancillary addition and fulfillment under Order Management `/orders/change`.

## Current implementation progress

- Fixed discovery parsing: missing item IDs no longer reject informational services; the public DTO uses nullable item IDs and exposes confirmed sellability separately from application booking availability.
- Every current lookup uses a shopping context and is explicitly display-only. A price of zero alone never makes an item bookable.
- BFM mapping now retains `passengerInfo.offerItemId` references and accepts both documented NDC source labels (`NDC_CONNECTOR` and `NDC_PLAYER`) with supplier `source: NDC` validation.
- Session/cache validation preserves these supplier references. The internal Offer Price client builds the documented `query[].offerItemId` request to `/v1/offers/price`, without fabricated payment/BIN details. This client is not exposed as an arbitrary supplier-ID proxy and is not yet connected to a pricing response mapper.
- The local 2026.08 collection contains an NDC Modify Booking example adding ancillary item references to traveller records using a fresh booking signature. It provides request examples, not verified response/fulfillment schemas.

## Required before enabling purchase

- Current Offer Price response schema: authoritative priced offer/item identifiers, passenger mapping, price/currency, expiry, itinerary and payment-fee constraints.
- NDC order creation/view integration with owned durable supplier order IDs.
- Current ancillary add/change and fulfillment response schemas and EMD/service evidence. Ticket/EMD settlement is not bypassed by a discovery API.
- Durable selected-extra/order/payment records, database migration, idempotent mutation claim, price acceptance, expiry handling, gateway/supplier reconciliation and a verified carrier/account response.

These prerequisites remain incomplete. No ancillary purchase, customer charge or EMD issuance was performed. Current display changes and an internal pricing request builder do not constitute a completed extras purchase flow.
