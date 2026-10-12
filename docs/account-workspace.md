# Customer account workspace

## Navigation

- My travel groups the existing `/app/bookings`, `/app/trips` and `/app/orders` list routes as accessible tabs. Detail URLs and existing booking/payment operations are preserved.
- Profile uses `?section=details|documents|preferences|security`. The old `/app/documents` list URL redirects to its Documents tab and preserves visa upload handoff state. Document detail URLs remain unchanged.
- The account menu groups travel/rewards, exploration/help and account settings. Phone navigation uses Home, Flights, Travel, Points and Profile.
- Tabs support arrow keys, Home/End, browser Back and direct links. Travel content loads within the tab panel.

## Profile and preferences

- Personal details and preferences save separate patches to the existing customer endpoint; saving one does not discard unsaved fields in the other.
- Language and currency defaults persist on the customer record, apply after sign-in, and update the current UI after a successful preference save. A navbar locale choice is a temporary override until the next sign-in/reload.
- Supported interface languages are English and Bengali. Existing unsupported saved preferences are retained until explicitly changed. Currency selection affects display amounts, not the authoritative payment currency.
- Security links use the existing reset-password flow. No credentials are changed automatically.

## Profile photo

- JPG, PNG and WebP inputs are limited to 5 MB and 40 megapixels. The browser crops to a 256px square and re-encodes JPEG, removing source metadata before upload.
- Photos use the existing authenticated private Documents API as OTHER documents named Profile photo. Only the document UUID is saved in auth user metadata (`flyseri_photo_document_id`); image data and signed URLs are not put into session tokens.
- The document API enforces ownership. Profile and navbar obtain short-lived signed URLs and renew them before expiry. Failed reads fall back to initials.
- Retries retain the document ID and upload idempotency key. Selecting a different file starts a new upload key on the same draft document. Previous photos are archived only after the new reference is saved. If archival fails, the old private file remains available under Documents for recovery.
- No new public storage bucket, database migration or server credential is introduced.

## Verification

- 30 focused web tests pass, covering account/auth/checkout regressions and new tab navigation, default preferences, private photo retry/removal and invalid upload cases.
- Frontend typecheck and production build pass.
- Browser layouts checked at 320, 375, 414 and 1280px. Profile/travel routes and menu navigation checked with existing saved records.
- Upload writes and preference mutations use mocked services in tests. This pass did not replace the user's actual photo, change their stored preferences or perform any booking/payment mutation. Physical-device keyboard and a real private photo upload remain separate acceptance checks.
- No deployment was performed.
