# Customer experience pass — 10 October 2026

This pass focuses on customer navigation, recovery and account usability. It preserves the existing visual baseline and adds no server integrations.

## Changes

- Public and account URLs now have a useful not-found page. Customer page rendering failures show recovery actions, including a reminder to check an in-progress booking/payment before submitting again. Navigating to another pathname resets the error boundary.
- My bookings is available in the account dropdown and the five-item phone navigation. Visa remains in the account menu and services drawer.
- The travel services drawer focuses its close control, keeps Tab navigation inside the modal, and restores focus when dismissed with Escape.
- Booking search has a clear-search-and-filters action; order filters have a show-all action. Booking counts are withheld while loading or unavailable.
- Dashboard failures no longer produce an “Up to date”, “No payment yet”, or “No flight selected” claim for information that could not load.
- Traveller mutations block repeat submissions and editing/cancellation during a save. A loading error no longer shows the contradictory “No travellers yet” state.
- Account form controls use 16px text at phone widths. Long references wrap within cards; the account menu can scroll on short screens. Support review content and action buttons have explicit spacing.

## Verification

- 31/31 targeted customer regression tests passed (`artifacts/client-ux-tests.json`).
- Customer TypeScript check and production build passed.
- Browser verified booking search/reset, unknown-link recovery, and navigation back to My bookings. Screenshot: `artifacts/client-page-recovery.jpg`.
- The browser viewport capability did not apply the requested phone dimensions, so phone layout was not visually verified in this pass. Real iPhone/Safari and Android keyboard/layout checks remain required.
- This is a focused customer experience pass, not a complete regression test of every route or a live supplier/payment test.
