# Agency Ancillaries Service API — retained user guide

Received from the user on 2026-10-03. The supplied markup has been normalized to Markdown. Example identifiers and monetary values are documentation examples, not application configuration or customer documents.

| Field | Supplied value |
| --- | --- |
| Title | Agency Ancillaries Service API |
| Function | Ticketing |
| Category | Air |
| Visibility restrictions | Empty |
| Description | The Agency Ancillaries API enables travel agents to service ancillaries (a.k.a. EMD) documents. Refunding ancillaries will be supported in the first release. |
| Production documentation | https://developer.sabre.com/rest-api/agency-ancillaries-service-api/1.0 |

## Overview

The API manages ancillary Electronic Miscellaneous Documents (EMDs), focusing on refunds in its initial release. It provides webservice access to EMD refund functionality previously handled through native entries, automates manual work, and aims to improve operational efficiency, agency service, processing speed and costs using Sabre infrastructure.

## How `/refund` works

1. Validate request syntax, data and refund qualifiers. `transactionId` and at least one document are required.
2. Retrieve EMD details from the airline system. Retrieval depends on whether the request uses `document.number` or `document.pnrTicketingItem`.
3. For a refundable EMD, initiate a full or partial refund according to individual coupon status.
4. On successful refund, commit updates to the EMD and PNR.
5. Return a `RefundResponse`, with a success message or errors and the echoed `transactionId`.

**Current limit: one document per request.** The field is still named `documents` and is an array.

## Authentication

The supplied guide specifies OAuth 2.0 **Client Credentials** and references OAuth Token Create API **v2**. Send `Authorization: Bearer {token}`. References supplied with the guide:

- `../../oauth-token-create-rest-api/v2/index.html`
- `/guide/get-token/get-token.html`

These authentication requirements need account-specific confirmation before implementation; the existing flight client uses a separately configured OAuth v3 adapter.

**Subsequent user clarification, 2026-10-03:** the user supplied the [OAuth v3 password-grant guide](OAUTH_V3.md) and selected OAuth v3 for the app. Preserve the original v2/client-credentials wording above as source provenance. Continue using the existing server OAuth v3 implementation; confirm the Agency Ancillaries service accepts the account's v3 token when its exact endpoint and entitlement are available. Do not switch the app globally to v2 from this guide's cross-reference.

## POST `/refund` request example

```json
{
  "transactionId": "TOMCOOK-01101605",
  "documents": [
    {
      "documentRefId": "DOC-1",
      "document": {
        "number": "2201234567890"
      },
      "refundQualifiers": {
        "commission": {
          "amount": {
            "amount": "10.00",
            "currencyCode": "USD"
          }
        }
      }
    }
  ]
}
```

## Response example

```json
{
  "transactionId": "TOMCOOK-01101605",
  "results": [
    {
      "documentRefId": "DOC-1",
      "status": "Success",
      "informational": [
        { "messageText": "EMD REFUND TRANSACTION PROCESSED" },
        { "messageText": "REFUND ACCOUNTING DATA CREATED IN PNR REFERENCE KZZZZZ" }
      ],
      "newPnrLocator": "KZZZZZ"
    }
  ]
}
```

## Missing contract details

The supplied text does not establish the full CERT/production endpoint URLs, the `pnrTicketingItem` schema, all refund qualifiers, error/status definitions, eligibility lookup and coupon schemas, timeout reconciliation, or supplier idempotency guarantees. Obtain the OpenAPI/Postman contract and agency entitlement for those details.

The documentation's production link is a documentation page, not the executable refund endpoint. Do not infer the service base path from `/refund` alone.
