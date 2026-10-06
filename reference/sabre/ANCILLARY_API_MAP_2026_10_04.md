# Agency ancillary API map

Reviewed in the authenticated Sabre Developer Hub on 4 October 2026. Documentation access does not establish PCC API entitlement or successful airline fulfillment. No booking or document issuance was performed during this review.

## Existing ATPCO / PNR flow

| Task | API | Integration notes |
| --- | --- | --- |
| Discover priced baggage, meals and other filed extras | SOAP GetAncillaryOffersRQ 3.2.0, Get Ancillary Offers for Travel Agencies | Passenger and segment associations, applicable fare/PQ details, marketing/operating carrier context. Returned content varies by airline and itinerary. |
| Retrieve current PNR | Booking Management Get Booking | Obtain the current bookingSignature without returnOnly before modifying. |
| Add or delete extras | Booking Management Modify Booking | Current capability table supports ATPCO ancillary addition/deletion. Pass confirmationId, bookingSignature and consistent before/after traveler data. Modification of an existing ancillary is not supported. |
| Add meal/wheelchair SSRs | Modify Booking specialServices or SOAP UpdateReservationRQ 1.19.22 | SSR requests are not confirmed merely because stored locally. Preserve returned airline status and passenger/segment associations. |
| Issue EMDs for paid extras | Booking Management Fulfill Flight Tickets | Documented ATPCO ticket/EMD issuance, forms of payment and printer designation. Requires approved settlement and fulfillment configuration. Stripe customer payment does not provide Sabre settlement. |

The older agency workflow sells/cancels Air Extras through SOAP UpdateReservationRQ and commits the PNR. REST Modify Booking orchestrates UpdateReservationRQ and is the preferred candidate for the app's existing REST booking client, subject to schema and CERT verification.

The Air Extras Search and Book workflow requires booked flights. Discovery may use a supported payload flow, but purchased extras must be associated with the saved booking. EMD workflow prerequisites include booked extras and issued tickets for associated flights.

Auto SSR is not enabled by default for agencies. If unavailable, explicitly include the required associated SSRs. Some carriers require additional SSRs beyond the filed one.

## NDC flow

Use Offer Price, then Agency Get Ancillaries `/v2/offers/getAncillaries`, then Order Management service additions or the supported Modify Booking ancillary flow. A BFM shopping offer can return display-only ancillary content without sellable offerItemIds; use priced offer/order context for purchase. Keep actual offer/item/passenger/segment references. Do not invent baggage increments or airline meal prices.

Current NDC fulfillment documentation permits entire-order fulfillment, not partial fulfillment of selected items. Mixed ATPCO/NDC hybrid fulfillment is unsupported.

## Airline-only documentation

Manage Ancillary REST 1.1 is labelled **Airline Carrier** and links to airline Get Ancillary Offers/Get Seats. Do not assume agency credentials permit it. The agency SOAP discovery and Booking Management paths avoid making that unsupported assumption.

## Retained reference examples

[ATPCO_Ancillary_2026_08_examples.json](ATPCO_Ancillary_2026_08_examples.json) extracts the relevant ATPCO workflow requests from the existing official 2026.08 collection. These are templates, not live responses. Its discovery examples use 3.1.0; do not change that version to 3.2.0 without reviewing the schema.

The current 3.2.0 resources page lists the May 2025 user guide, WSDL/XSD ZIP, request/response design documents, and booking-payload request/response XML examples. The browser download did not yield a local file, so these resources have not been represented as downloaded.

## Authoritative pages

- [Agency discovery 3.2.0](https://developer.sabre.com/soap-api/get-ancillary-offers-for-travel-agencies/3.2.0/index.html)
- [Agency discovery resources](https://developer.sabre.com/soap-api/get-ancillary-offers-for-travel-agencies/3.2.0/resources.html)
- [Air Extras Search and Book](https://developer.sabre.com/guide/air-extras-search-and-book/air-extras-search-and-book.html)
- [Update Itinerary 1.19.22](https://developer.sabre.com/soap-api/update-itinerary/v1.19.22)
- [Modify Booking current capabilities](https://developer.sabre.com/rest-api/booking-management-api/v1/help-documentation/modify-booking-0.html)
- [Fulfill Flight Tickets](https://developer.sabre.com/rest-api/booking-management-api/v1/help-documentation/fulfill-flight-tickets.html)
- [EMD workflow](https://developer.sabre.com/guide/issue-electronic-miscellaneous-documents-for-air-extras-and-paid-seats/issue-electronic-miscellaneous-documents-for-air-extras-and-paid-seats.html)
- [Manage Ancillary airline scope](https://developer.sabre.com/rest-api/manage-ancillary/1.1/index.html)

## Remaining implementation work

The trial now includes a CERT-only SOAP GetAncillaryOffersRQ 3.2.0 payload adapter and an XML response normalizer. Both public traveler details and saved-traveler checkout expose the lookup. ATPCO discovery uses passenger counts and does not transmit traveler names. The adapter rejects unsupported codeshares, child/infant flows, SOAP faults, unsafe XML, and services lacking passenger/segment associations. Returned services remain display-only; shopping data does not contain the full fare/PQ context needed to guarantee purchase prices.

Per-traveler requests are saved in the existing database field and displayed in fare review, reservation details, order/payment review, and downloaded reservation summaries. Production Sabre endpoints are rejected by server configuration; Stripe accepts test keys only.

One fresh CERT lookup completed for US-Bangla BS316, KUL–DAC on 5 November 2026, and returned no additional offers. Still required: validate priced SOAP responses and actual response associations; integrate quote selection with passenger/segment binding; persist priced selections separately from staff requests; revalidate before charging; add PNR modifications with bookingSignature handling; fulfill and reconcile EMDs only when settlement is configured. Paid purchase remains disabled rather than declaring requests purchased.

The reservation follow-up adds ATPCO child/infant payloads with age/count checks and associated meal/accessibility SSR requests. NDC Offer Price v1.5 was reviewed in the authenticated Reference documentation. A strict price/context mapper and Booking Management NDC CreateBooking variant are now connected; the guest checkout block was removed. These additions compile but lack successful CERT booking evidence. Discovery for child/infant passengers remains unsupported, and NDC ancillary lookup still uses the shopping context rather than a separately selectable priced-extra flow.
