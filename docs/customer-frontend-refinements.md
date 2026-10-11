# Customer frontend refinement pass

## Implemented

- Shared responsive skeleton for route loading and session restoration, with reduced-motion support.
- Offline guidance that asks customers to check booking status before retrying payment.
- Extras loading recovery that preserves selections and does not save anything automatically.
- Mobile price sheet keyboard containment, Escape dismissal, focus restoration and background scroll locking.
- Narrow-screen payment bar wrapping, safe-area spacing and text-field focus behavior.
- Explicit payment amount in the order's settlement currency, independent of estimated display conversions.
- Stronger keyboard focus outlines and supporting-text contrast.
- Hero slideshow stops requesting additional slides on data-saving or 2G connections.
- Cached map fare polling pauses offline and in hidden tabs, prevents overlapping requests and resumes on reconnection/visibility.
- Traveler and contact errors appear beside the affected fields with accessible descriptions and focus on the first error.
- Interrupted payments retain their request key across page reloads and require a status check before another attempt. Failed status refreshes block payment from stale order data.
- Offer review includes the selected traveler total, included baggage, taxes, available dates and conditions before the existing five-minute demo hold starts.
- Demo name errors, expiry announcements and stage focus support keyboard and screen reader use.
- Custom selection controls support arrows, Home/End, Escape and placement inside the visible viewport when a mobile keyboard reduces its height.
- Public `/help` page and footer links provide booking, payment, company and demo-policy information without requiring sign-in. Sending a support request still requires sign-in.

## Verification

- 75 focused frontend regression tests passed across 11 files. The saved report is `artifacts/customer-journey-refinements-tests.json`.
- Customer TypeScript checking and production build passed.
- Browser previews of the actual guest checkout at 320, 375 and 414 px had no horizontal document overflow.
- Browser verified Escape closes the mobile price sheet and restores trigger focus, and focusing a traveler text field hides the fixed bottom action bar.
- Responsive screenshot: `artifacts/frontend-responsive-refinements.jpg`.
- Mobile offer review screenshot: `artifacts/customer-offer-mobile.jpg`. The offer dialog and help page had no horizontal overflow at the same phone widths.
- Browser verified inline field descriptions and automatic focus on the first invalid traveler field, as well as the selected two-traveler demo total and five-minute hold.
- The temporary responsive fixture uses illustrative fare data; it does not reserve seats or create payments. Fixture source files were removed after verification.

## Remaining external requirements

- Physical iPhone/Safari and Android keyboard and safe-area verification. Browser previews are not a substitute for physical-device testing.
- Verified public company contact details and approved commercial privacy, booking, cancellation and refund policy text. Existing demo policies remain clearly identified.
- This is a focused frontend pass, not a complete accessibility certification, network benchmark or proof of live airline/payment fulfillment.
- Local API startup exposed a holiday endpoint dependency error; account endpoints subsequently returned successfully. This pass did not change backend dependency handling.
- Deployment verification is tracked separately from these local checks.
