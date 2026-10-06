# Booking management

## Retained source information

`Order_Management_API_user_overview.txt` is the user's supplied Order Management overview, preserved as received on 2026-10-03. It describes NDC orders, not the existing ATPCO reservation path. It is an overview rather than a request/response schema.

Implementation order selected by the user: **existing PNR bookings first, then NDC orders**.

Existing PNR contracts come from `Booking_Management_API_v2_2026.08.postman_collection.json`. NDC guidance is also available in [Sabre's NDC product collection](https://developer.sabre.com/product-collection/new-distribution-capability-ndc/v1/index.html) and [Offers and Orders user guide](https://developer.sabre.com/sites/default/files/2024-04/Sabre%20Offers%20and%20Orders%20APIs%20user%20guide%20v1.6.pdf).

## Implemented PNR flow

- `/app/bookings`: authenticated customer booking list, including failed and uncertain attempts.
- `/app/bookings/:bookingId`: saved itinerary, accepted fare, passengers, PNR and latest successful PNR verification time.
- Checked flight selections show a reservation form with contact and billing details.
- `GET /api/v1/flights/bookings/capabilities`: reservation availability without exposing server configuration.
- `GET /api/v1/flights/bookings`: customer-owned records, latest 100.
- `GET /api/v1/flights/bookings/:id`: customer-owned detail.
- `POST /api/v1/flights/bookings/:id/refresh`: verifies the stored PNR with Sabre GetBooking and returns documented current flight, passenger and ticket document fields. It checks booking identity before recording a refresh.
- `POST /api/v1/flights/bookings/:id/cancel`: confirms the customer-entered PNR, claims the operation and checks fresh provider details. Only a verified unticketed flight-only PNR without an order is eligible. Cancellation is marked complete only after a follow-up lookup confirms flights were removed; uncertain mutations require staff review.
- `POST /api/v1/flights/booking-intents/:id/reserve`: adult ATPCO reservation creation.

Creation requires a fresh accepted fare, confirmed legal names, owned adult traveller profiles, date of birth, contact information, billing address and configured agency data. FlightCheck must identify exactly one matching booking class offer for the configured PCC and match the accepted amount and currency. A mismatch stops before CreateBooking. Concurrent requests claim the intent in PostgreSQL; only one reservation attempt can be sent per intent. Subsequent requests restore that attempt. Timeouts and unreadable confirmations remain unknown and require reconciliation. No automatic CreateBooking retry occurs.

Only CERT reservation creation can be enabled. Set `FLIGHT_BOOKING_EXECUTION_ENABLED=true` and `SABRE_BOOKING_AGENCY` in the server environment, with the approved agency address, customer number and ticketing policy. Sample agency fields from the Postman collection must not be used as business configuration. Credentials remain in the server environment. Execution remains disabled until approved agency configuration is supplied.

The user confirmed that the configured PCC is the agency/customer number for this account. If the agency JSON omits that number or leaves it empty, the server uses its configured PCC. The agency name, address and ticketing policy must still be supplied.

## Limits

The initial PNR view displays the saved itinerary and accepted fare. GetBooking refresh returns a separate current provider view with flight segments, passenger names and ticket document numbers/statuses; that provider view is not yet persisted. It does not map coupon status or automatically set the database booking status to TICKETED. Unticketed cancellation is implemented with the narrow eligibility checks described above and requires configured CERT execution. Ticket issuance, flight modification, ticketed cancellation, void and refund remain unimplemented and direct the customer to Flyseri support. Child and infant reservations are not enabled. Guest checkout attempts remain separate from authenticated reservations.

No production reservation, charge or ticket has been made as part of this implementation. Compilation and builds cannot establish supplier account entitlement or successful end-to-end booking.

## Next stage: NDC

Implement the current account-approved request/response schemas and carrier support before enabling these operations:

1. Shop and price a sellable NDC offer (`Offers/Price`) before `Orders/Create`. Preserve the supplier offer ID separately from Flyseri offer IDs.
2. `Orders/View` and `Orders/Sync`, retaining both Sabre and carrier identifiers. Sync acknowledgement is not proof that asynchronous synchronization completed.
3. Passenger data changes via `Orders/Change`, with supported fields and carrier restrictions. This operation does not change flights.
4. Cancellation eligibility and fees via `Offers/Reshop/CancelOrder` before cancelling a fulfilled order. Show the fees and expiry before committing a cancellation; use the returned offer item IDs.
5. Fulfillment through `Orders/Change`. Verify issued documents from the provider response; a PNR or local payment success alone is not ticket issuance.
6. Flight exchange after `Offers/Reshop/Shop`, including explicit acceptance of pricing, fulfillment and itinerary/ticket synchronization handling.
7. Divide an eligible order one passenger at a time, retaining links to the new order and PNR.

The pasted overview describes a single-adult creation limitation. Validate current version and carrier rules against the approved schema before implementing wider passenger or ancillary support.
