# Flyseri Points — first implementation

## Rules

- 1 whole point per **BDT 1,000** of eligible cash base fare, rounded down per booking.
- 1 point redeems for BDT 1; minimum 100 points; maximum 10% of eligible fare.
- Taxes, fees, extras, non-BDT fares, missing/unreconciled fare breakdowns, demo bookings and sandbox payments are excluded.
- Pending points require a confirmed matching payment. Available points additionally require an issued ticket, owner verification of the completed final flight, and a 7-day waiting period.
- Available points expire after 12 months. Earliest expiry is spent first. Restored points retain the original expiry with at least 30 days of grace.
- Awards belong to the purchasing customer account, once per order. No transfers or cash withdrawals.
- Rule version `BDT-1000-v1` is recorded with each lot. Rates are fixed in this version; editing them requires a versioned migration/implementation, not an arbitrary browser setting.

## Customer surfaces

- `/app/points`: authenticated wallet, available/pending/reserved balances, refund adjustment, expiry notice within 30 days, and paginated activity.
- Flight order payment page: server quote, eligibility explanation, redemption amount and refreshed payment total. Applying points clears the customer's total confirmation and disables payment during the update.
- Account navigation: Flyseri Points.
- `/demo/points`: isolated browser-memory rehearsal with 500 sample points. Apply 100 points to a BDT 25,000 sample fare, pay BDT 24,900, earn 24 pending points, simulate completed travel and release, then refund to restore the sample balance. Reset/reload clears it. No rewards, payment or airline API is used by the simulator.

## Storage and integrity

Migration: `packages/database/drizzle/0030_flyseri_points.sql`, registered in the Drizzle journal. It creates RLS-protected accounts, earning lots, redemption allocations and an append-only API ledger. The API role has no ledger update/delete grants.

Mutations run in PostgreSQL transactions. Orders are locked before the points account. Account locks serialize spending across separate checkouts. Earning is unique per order; cumulative refund totals cannot decrease; staff adjustment keys are claimed atomically before crediting. No browser balance or client-supplied fare is trusted.

Redemption lowers the existing authoritative order discount/total. Once any payment record exists, points cannot be changed. Unpaid, abandoned reservations are released on expiry/cancellation. Reservations associated with attempted or uncertain payments stay locked for reconciliation; this version deliberately does not assume that a failed browser request or an expired checkout proves that no charge occurred.

Customer wallet reads reconcile eligible paid orders and due verified journeys, then expire unused lots. Checkout quotes reconcile their individual order. This is reconciliation on access; there is no separate scheduler, email reminder sender or provider refund integration in this version.

Refund reconciliation reverses earned points, proportionally restores redeemed points, and records spent-point shortfalls as a future rewards adjustment. Expired unused points do not create debt, but previously spent points still do. Unpaid holds cannot extend expiry. If points from the refunded ticket are reserved in another checkout, that checkout must reconcile before its rewards refund can be adjusted. It never debits customer money. Owners must verify the cumulative **eligible cash base-fare** refund amount from the payment/refund record; this endpoint adjusts rewards only and does not issue a refund or cancel a ticket.

## API

All paths below are under `/api/v1`.

| Endpoint | Access | Purpose |
| --- | --- | --- |
| `GET /points?page=1` | Customer | Own wallet and 20 activity entries |
| `GET /points/orders/:orderId` | Customer | Own order eligibility and quote |
| `POST /points/orders/:orderId` | Customer | `{ points: integer }`; zero removes points before payment |
| `GET /admin/points/customers/:customerId?page=1` | Staff with orders permission | Customer wallet |
| `POST /admin/points/customers/:customerId/adjust` | Owner settings permission | Signed nonzero points, UUID idempotencyKey, evidence |
| `POST /admin/points/customers/:customerId/orders/:orderId/verify-journey` | Owner settings permission | completedAt and evidence |
| `POST /admin/points/customers/:customerId/orders/:orderId/refund` | Owner settings permission | cumulativeEligibleRefund and evidence |

Evidence is stored for audit and is not returned in customer activity. The separate CRM admin interface has not been changed by this workspace implementation.

## Activation boundary

The current platform only supports Sabre CERT and Stripe test payments. `PointsService.redemptionEnabled` is intentionally false. The API repository's live lifecycle is exercised using isolated PostgreSQL fixtures; demo/sandbox transactions cannot award real points. The customer demo works now without a database migration.

Before enabling real rewards:

1. Apply migration 0030 through the normal database release process before deploying the new API/UI. It was tested locally against the full migration chain; it has not been applied to the shared or production database by this task.
2. Integrate a verified live booking/payment adapter and explicitly enable redemption. Recheck redemption holds at payment creation, synchronize successful/failed/late payment outcomes, and link provider refunds/chargebacks to rewards reconciliation. Holds after attempted payments require that reconciliation before release.
3. Connect the owner endpoints to the CRM admin UI, publish approved rewards terms, and add a scheduled reconciler/expiry notifications if required independently of customer visits.
4. Verify simultaneous redemptions against the deployed PostgreSQL service and exercise real provider failure/refund cases in the provider sandbox with an isolated rewards namespace. PGlite tests validate transactions and lifecycle but do not simulate multi-connection network concurrency.
5. Validate physical iPhone/Android keyboard interactions. Browser layout checks cover 320, 375 and 414 pixel phone widths.

No production deployment, shared database mutation, real payment or airline operation is part of this development pass.
