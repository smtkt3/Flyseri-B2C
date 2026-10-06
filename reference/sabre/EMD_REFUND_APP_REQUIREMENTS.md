# EMD refund requirements for Flyseri

Assessment dated 2026-10-03, based on the [retained user guide](AGENCY_ANCILLARIES_SERVICE.md) and current workspace code.

## Role in the application

Agency Ancillaries Service is a servicing operation for an **issued EMD**. It complements ancillary offer retrieval, ancillary reservation and EMD issuance. It does not supply the initial baggage/meal shopping response.

Keep supplier EMD refunds and payment-gateway refunds as distinct operations with separate evidence. Airline refund success does not prove that Flyseri has returned money through its gateway. Some documents may have been settled directly with an airline and require different reconciliation.

## Required elements

| Element | App requirement | Current gap |
| --- | --- | --- |
| Issued document inventory | Store actual EMD number, document type, associated owned booking, passenger, ancillary service and flight/coupon references | Booking view currently maps `flightTickets`; no dedicated EMD inventory or coupon mapping |
| Eligibility and value | Retrieve refundable coupon state, currency, eligible value, fees and settlement evidence before approval; partial refunds must follow actual coupon status | Supplied response does not state the refunded amount; the commission qualifier is not the customer refund amount |
| Access and approval | Customer can request a refund on their own document; staff reviews the airline rules and approves the execution | No EMD-specific customer request or staff execution workflow |
| Durable attempt | Persist unique local operation ID, supplier `transactionId`, `documentRefId`, approved inputs, actor, timestamps and status before the supplier call | Existing payment refund records do not carry these supplier document/operation fields |
| One-document execution | Validate exactly one document per API request; handle a multi-document customer request as individually tracked operations | No Agency Ancillaries client/dispatcher |
| Qualifiers | Validate only supported, approved qualifiers against the provider schema; use actual accounting values | Only one commission example supplied; do not use example values as defaults |
| Result validation | Match echoed transaction ID and the exact document reference, then inspect the per-document result/errors; HTTP 200 alone is insufficient | No normalized EMD refund response mapper |
| Uncertain outcomes | Timeouts, transport failures and unreadable confirmations remain pending reconciliation; prevent duplicate automatic refund attempts | Existing `refunds` statuses are REQUESTED/PROCESSING/SUCCEEDED/FAILED/CANCELLED; no explicit supplier unknown/review state |
| PNR changes | Record a returned `newPnrLocator`, retain previous locator history and refresh supplier document/booking evidence before applying it | Current booking model stores one PNR locator; no refund-specific locator history |
| Customer money return | Track supplier refund settlement and gateway payout independently, with actual amount/currency and reconciliation | Existing refund table requires payment/order IDs; it cannot represent every supplier EMD servicing attempt independently |
| Audit and notifications | Preserve approved financial fields, per-document result and actor linkage; notify the customer using confirmed supplier and payment outcomes | Commerce audit/outbox foundations exist; no EMD refund operation or staff actor evidence workflow |
| Server activation | Use the user-selected OAuth v3 server implementation; confirm the service accepts that token, exact URLs, account entitlement and environment | Existing transport matches the supplied v3 guide. The older Agency Ancillaries guide references v2 client credentials; service compatibility still needs confirmation |

## Integration order

1. Map and persist issued EMDs and coupon evidence from the verified booking/document APIs.
2. Obtain the full Agency Ancillaries OpenAPI contract, including eligibility, errors, authentication and exact endpoints.
3. Add refund requests and staff review with an approved refundable amount and settlement route.
4. Implement one-document supplier execution with a durable claim, result verification and reconciliation.
5. Connect any required customer gateway refund and status notifications after the supplier outcome is confirmed.

## Important contract boundaries

- An echoed `transactionId` does **not** by itself establish provider idempotency. Verify retry and transaction lookup semantics before enabling retries.
- A successful document result does not establish the monetary amount refunded. Obtain accounting/document evidence rather than deriving it from the example commission value or informational text.
- `newPnrLocator` can affect subsequent servicing. Do not overwrite booking identity from an unverified or mismatched result.
- The existing Booking Management reference also lists EMD-capable `refundFlightTickets` and `voidFlightTickets`. Choose the supported account/carrier workflow and use a single durable document operation lock across refund adapters to avoid duplicate servicing.

No refund execution or financial database changes were made for this documentation review.
