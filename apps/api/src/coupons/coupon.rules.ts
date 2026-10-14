import { ApiException } from '../api-exception.js';

export const couponConflict = (message: string) => new ApiException('CONFLICT', message, 409);
export function minor(value: string): bigint {
  if (!/^(0|[1-9]\d{0,15})(\.\d{1,2})?$/.test(value)) throw couponConflict('Invalid discount amount.');
  const [whole, fraction = ''] = value.split('.');
  return BigInt(whole!) * 100n + BigInt(fraction.padEnd(2, '0'));
}
export const decimal = (value: bigint) => `${value / 100n}.${String(value % 100n).padStart(2, '0')}`;
export interface CouponRow {
  id: string; code: string; discount_type: 'PERCENT'|'FIXED'; discount_value: string;
  currency: string; minimum_spend: string; maximum_discount: string|null;
  starts_at: Date|null; expires_at: Date|null; usage_limit: number|null;
  per_customer_limit: number; applies_to: string; active: boolean; version: number;
}
export function discountFor(c: CouponRow, order: {currency:string; subtotal_amount:string; booking_intent_id:string|null}, now:Date): bigint {
  if (!c.active || c.starts_at && c.starts_at > now || c.expires_at && c.expires_at <= now)
    throw couponConflict('This coupon is not currently available. Remove it or choose another code.');
  if (c.currency !== order.currency) throw couponConflict(`This coupon is only valid for payments in ${c.currency}.`);
  if (c.applies_to !== 'ALL' && c.applies_to !== (order.booking_intent_id ? 'FLIGHT':'VISA')) throw couponConflict('This coupon is not valid for this order.');
  const base = minor(order.subtotal_amount);
  if (base < minor(c.minimum_spend)) throw couponConflict(`Spend at least ${c.currency} ${c.minimum_spend} to use this coupon.`);
  let amount = c.discount_type === 'FIXED' ? minor(c.discount_value) : base * minor(c.discount_value) / 10000n;
  if (c.maximum_discount) amount = amount > minor(c.maximum_discount) ? minor(c.maximum_discount) : amount;
  if (amount <= 0n || amount >= base) throw couponConflict('This coupon cannot be used for this order total.');
  return amount;
}

// A hold with any payment record remains counted until payment reconciliation proves it safe.
// This prevents abandoned or uncertain provider sessions from spending the same last use twice.
export const countedRedemptions = `r.state <> 'RELEASED' AND (r.expires_at > now() OR r.state = 'CAPTURED'
  OR EXISTS (SELECT 1 FROM payments p WHERE p.order_id = r.order_id))`;
