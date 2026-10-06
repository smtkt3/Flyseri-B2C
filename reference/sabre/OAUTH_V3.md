# OAuth Token Create REST API v3 — retained user guide

Supplied by the user on 2026-10-03. Markup is normalized below; long illustrative token strings are replaced with placeholders. No actual credentials or access tokens are stored in this document.

| Field | Supplied value |
| --- | --- |
| Title | OAuth Token Create REST API |
| Function | Utility |
| Category | Session Management |
| Visibility restrictions | Empty |
| Description | OAuth `grant_type=password` authentication; a token is created for a particular ClientID. Contact the account manager to provision a new ClientID. |
| Documentation | https://developer.sabre.com/rest-api/oauth-token-create-rest-api/v3 |

## Overview

The authentication endpoint creates an ATK access token used to access other Sabre APIs. A valid, unexpired sessionless token can be reused for multiple business API calls.

Version v3 combines a trusted developer application's ClientID credentials with user credentials (EPR and password) using the `password` grant.

## Request contract

`POST /v3/auth/token`

- `Content-Type: application/x-www-form-urlencoded`
- `Authorization: Basic base64(clientId:clientSecret)`
- Form parameter `grant_type=password`
- Form parameter `username`: provisioned EPR in **user-group-domain** format
- Form parameter `password`: EPR password

The supplied example describes authentication **without two-factor authentication**. It does not establish a two-factor request contract.

Production URL supplied in the guide: `https://api.platform.sabre.com/v3/auth/token`.

The app's approved existing CERT URL: `https://api.cert.platform.sabre.com/v3/auth/token`.

Use the provisioned username; do not reconstruct or replace its group/domain using an unverified assumption about PCC or EPR.

## Successful response

```json
{
  "access_token": "<ATK access token>",
  "expires_in": 604800,
  "token_type": "bearer"
}
```

`expires_in` is the returned TTL in seconds. The sample value is not a fixed application setting: cache expiry must use the actual returned TTL.

## Business API authentication

REST requests use:

```http
Authorization: Bearer <ATK access token>
```

The supplied SOAP example places the ATK in `wsse:BinarySecurityToken` within `wsse:Security`, with `valueType="String"` and `EncodingType="wsse:Base64Binary"`. No SOAP integration is added here.

## Supplied references

- `/guide/rest-apis-token-credentials/rest-apis-token-credentials.html`
- Account manager provisioning for ClientID and EPR user-group-domain credentials.

## Current implementation review

Reviewed on 2026-10-03:

- `apps/api/src/flight/sabre-oauth-v3.fetcher.ts` already sends the form-encoded password grant, Basic ClientID/client-secret authentication, and configured EPR username/password.
- It validates the token response, returned positive TTL and bearer token type; redirects are rejected and requests have a timeout.
- `sabre-auth.service.ts` reuses cached tokens with an expiry margin and coalesces refreshes. Redis supports coordination between server instances; local caching is limited to non-production fallback.
- Server business clients use Bearer authorization. BFM shopping invalidates and refreshes once after HTTP 401. Other clients do not yet share this refresh/retry behavior; mutation retries require operation-specific outcome handling.
- Token requests and credentials remain on the server. The token fetcher is intentionally restricted to the configured CERT endpoint; this guide does not activate production access.

No authentication code change was necessary to match this supplied v3 guide. Compatibility of a v3 token with an individual API still depends on the account's entitlement and that API's contract.
