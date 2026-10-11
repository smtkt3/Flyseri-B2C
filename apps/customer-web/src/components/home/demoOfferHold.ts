export const DEMO_HOLD_DURATION_MS = 5 * 60 * 1000;
export type DemoOfferHold = { expiresAt: number; completedAt?: number; bookingId?: string };
type Store = Pick<Storage, 'getItem' | 'setItem'>;
export function readOrCreateDemoHold(storage: Store | undefined, key: string, now = Date.now()): DemoOfferHold {
  try {
    const raw = storage?.getItem(key);
    if (raw) {
      const hold = JSON.parse(raw) as DemoOfferHold;
      if (Number.isFinite(hold.expiresAt) && hold.expiresAt <= now + DEMO_HOLD_DURATION_MS && (hold.completedAt === undefined || Number.isFinite(hold.completedAt))) return hold;
    }
  } catch { /* In-memory use remains available when browser storage is blocked. */ }
  const hold = { expiresAt: now + DEMO_HOLD_DURATION_MS };
  try { storage?.setItem(key, JSON.stringify(hold)); } catch { /* No personal data is stored. */ }
  return hold;
}
export function demoHoldRemaining(hold: DemoOfferHold, now = Date.now()) {
  return Math.max(0, Math.ceil((hold.expiresAt - now) / 1000));
}
export function finishDemoHold(storage: Store | undefined, key: string, hold: DemoOfferHold, now = Date.now()): DemoOfferHold | null {
  if (hold.completedAt || now >= hold.expiresAt) return null;
  const completed = { ...hold, completedAt: now };
  try { storage?.setItem(key, JSON.stringify(completed)); } catch { /* Keep completion in memory. */ }
  return completed;
}
