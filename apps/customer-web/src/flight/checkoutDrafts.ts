// Private checkout fields stay in tab memory, never localStorage or router history.
const drafts = new Map<string, { owner: string | null; expiresAt: number; value: unknown }>();
export function readCheckoutDraft<T>(key: string, owner: string | null): T | undefined {
  const draft = drafts.get(key);
  if (!draft || draft.expiresAt <= Date.now()) { drafts.delete(key); return undefined; }
  return draft.owner === owner ? structuredClone(draft.value) as T : undefined;
}
export function keepCheckoutDraft<T>(key: string, owner: string | null, value: T): void {
  for (const [id, draft] of drafts) if (draft.expiresAt <= Date.now()) drafts.delete(id);
  drafts.delete(key);
  drafts.set(key, { owner, expiresAt: Date.now() + 30 * 60_000, value: structuredClone(value) });
  while (drafts.size > 20) drafts.delete(drafts.keys().next().value!);
}
export function clearCheckoutDraft(key: string): void { drafts.delete(key); }
const uncertainAttempts = new Set<string>();
export const reservationRecoveryKey = (intentId: string, owner: string) => `${owner}:${intentId}`;
export function markReservationUncertain(key: string) { uncertainAttempts.add(key); }
export function reservationNeedsRecovery(key: string) { return uncertainAttempts.has(key); }
export function clearReservationRecovery(key: string) { uncertainAttempts.delete(key); }
