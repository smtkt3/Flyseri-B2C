import { randomUUID } from '../lib/randomUUID';
type Attempt = { key: string; uncertain: boolean };
const fallback = new Map<string, Attempt>();
const storageKey = (orderId: string) => `flyseri.payment-recovery.${orderId}`;
export function readPaymentAttempt(orderId: string): Attempt | undefined {
  try {
    const raw = sessionStorage.getItem(storageKey(orderId));
    if (raw) { const value = JSON.parse(raw); if (typeof value.key === 'string' && typeof value.uncertain === 'boolean') return value; }
  } catch { /* Tab memory still supports recovery when browser storage is unavailable. */ }
  return fallback.get(orderId);
}
export function keepPaymentAttempt(orderId: string, uncertain: boolean): Attempt {
  const attempt = { key: readPaymentAttempt(orderId)?.key ?? randomUUID(), uncertain };
  fallback.set(orderId, attempt);
  try { sessionStorage.setItem(storageKey(orderId), JSON.stringify(attempt)); } catch { /* No billing details are stored. */ }
  return attempt;
}
export function clearPaymentAttempt(orderId: string) {
  fallback.delete(orderId);
  try { sessionStorage.removeItem(storageKey(orderId)); } catch { /* Optional browser storage. */ }
}
