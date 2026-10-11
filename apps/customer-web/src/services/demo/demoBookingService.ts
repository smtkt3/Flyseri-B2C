// Browser-only rehearsal. This module must never call booking, payment or airline APIs.
export type DemoBookingStatus = 'HELD' | 'PAYMENT_PENDING' | 'PAYMENT_FAILED' | 'PAID' | 'PAYMENT_REVIEW' | 'TICKETED' | 'CANCELLED' | 'EXPIRED' | 'REFUNDED';
export type DemoBooking = {
  id: string; destination: string; city: string; departure: string; travellers: number;
  amountPerPerson: number; currency: string; expiresAt: number; createdAt: number;
  status: DemoBookingStatus; paymentAttempts: number; paidAt?: number; ticket?: string;
  history: Array<{ at: number; text: string }>;
};
export type DemoBookingAction = 'PAY_SUCCESS' | 'PAY_FAILURE' | 'PAY_PENDING' | 'RESOLVE_SUCCESS' | 'RESOLVE_FAILURE' | 'ISSUE' | 'CANCEL' | 'REFUND' | 'EXPIRE';
const key = 'flyseri.demo-bookings.v1';
const statuses: DemoBookingStatus[] = ['HELD','PAYMENT_PENDING','PAYMENT_FAILED','PAID','PAYMENT_REVIEW','TICKETED','CANCELLED','EXPIRED','REFUNDED'];
type Store = Pick<Storage, 'getItem' | 'setItem'>;
function storage(): Store { return window.sessionStorage; }
export function readDemoBookings(store = storage()): DemoBooking[] {
  const raw = store.getItem(key);
  if (!raw) return [];
  const data: unknown = JSON.parse(raw);
  if (!Array.isArray(data) || data.length > 20 || !data.every(value => value && /^DEMO-[A-Z0-9-]+$/.test(value.id) && /^[A-Z]{3}$/.test(value.destination) && typeof value.city === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value.departure) && Number.isInteger(value.travellers) && value.travellers >= 1 && value.travellers <= 9 && Number.isFinite(value.amountPerPerson) && value.amountPerPerson > 0 && /^[A-Z]{3}$/.test(value.currency) && Number.isFinite(value.expiresAt) && Number.isFinite(value.createdAt) && statuses.includes(value.status) && Number.isInteger(value.paymentAttempts) && Array.isArray(value.history) && value.history.every((event: {at?: unknown; text?: unknown}) => Number.isFinite(event.at) && typeof event.text === 'string'))) throw new Error('Saved demo data could not be read. Clear this tab’s demo data to start again.');
  return data;
}
function save(values: DemoBooking[], store: Store) {
  try { store.setItem(key, JSON.stringify(values)); }
  catch { throw new Error('Demo storage is unavailable or full. Enable browser storage and try again.'); }
}
export function createDemoBooking(input: Pick<DemoBooking, 'destination' | 'city' | 'departure' | 'travellers' | 'amountPerPerson' | 'currency'>, options: { now?: number; expiresAt?: number; store?: Store } = {}): DemoBooking {
  const now = options.now ?? Date.now(); const store = options.store ?? storage();
  if (!/^[A-Z]{3}$/.test(input.destination) || !input.city || !/^\d{4}-\d{2}-\d{2}$/.test(input.departure) || !Number.isFinite(Date.parse(input.departure)) || input.departure < new Date(now).toISOString().slice(0,10) || !Number.isInteger(input.travellers) || input.travellers < 1 || input.travellers > 9 || !Number.isSafeInteger(Math.round(input.amountPerPerson * input.travellers * 100)) || input.amountPerPerson <= 0 || !/^[A-Z]{3}$/.test(input.currency)) throw new Error('Check the demo route, date, travellers and fare.');
  const expiresAt = options.expiresAt ?? now + 300000;
  if (expiresAt <= now || expiresAt > now + 300000) throw new Error('The demo hold has expired. Start a new selection.');
  const value: DemoBooking = { ...input, id: 'DEMO-' + crypto.randomUUID().toUpperCase(), status: 'HELD', createdAt: now, expiresAt, paymentAttempts: 0, history: [{ at: now, text: 'Demo reservation created · five-minute payment window' }] };
  save([value, ...readDemoBookings(store)].slice(0,20), store); return value;
}
/** Pure transition logic, also used by the demo UI. Expiry is checked at action time. */
export function transitionDemoBooking(value: DemoBooking, action: DemoBookingAction, now = Date.now()): DemoBooking {
  const held = ['HELD','PAYMENT_FAILED'].includes(value.status);
  if (held && now >= value.expiresAt) return { ...value, status: 'EXPIRED', history: [...value.history, { at: now, text: 'Demo payment window expired · no payment taken' }] };
  if (action === 'EXPIRE') return value;
  let status: DemoBookingStatus; let text: string; let attempts = value.paymentAttempts;
  if (action.startsWith('PAY_')) {
    if (!held) throw new Error('A payment is already pending, completed, or unavailable. Check the saved status.');
    attempts++;
    status = action === 'PAY_SUCCESS' ? 'PAID' : action === 'PAY_FAILURE' ? 'PAYMENT_FAILED' : 'PAYMENT_PENDING';
    text = status === 'PAID' ? 'Demo payment approved · no money collected' : status === 'PAYMENT_FAILED' ? 'Demo payment declined · retry available before expiry' : 'Demo payment pending · do not pay again';
  } else if (action === 'RESOLVE_SUCCESS' || action === 'RESOLVE_FAILURE') {
    if (value.status !== 'PAYMENT_PENDING') throw new Error('There is no pending demo payment to check.');
    status = action === 'RESOLVE_SUCCESS' ? now >= value.expiresAt ? 'PAYMENT_REVIEW' : 'PAID' : now >= value.expiresAt ? 'EXPIRED' : 'PAYMENT_FAILED';
    text = status === 'PAYMENT_REVIEW' ? 'Demo payment approved after expiry · review required before ticketing' : status === 'PAID' ? 'Pending demo payment approved · no money collected' : 'Pending demo payment failed · no money collected';
  } else if (action === 'ISSUE') {
    if (value.status !== 'PAID') throw new Error('A successful eligible demo payment is required before demo ticketing.');
    status = 'TICKETED'; text = 'Demo ticket document prepared · not valid for travel';
  } else if (action === 'CANCEL') {
    if (!held) throw new Error('Only an unpaid demo reservation can be cancelled. Paid bookings use the demo refund action.');
    status = 'CANCELLED'; text = 'Demo reservation cancelled · no money collected';
  } else {
    if (!['PAID','TICKETED','PAYMENT_REVIEW'].includes(value.status)) throw new Error('Only a paid demo booking can be refunded.');
    status = 'REFUNDED'; text = 'Demo refund completed · no real refund or airline cancellation';
  }
  return { ...value, status, paymentAttempts: attempts,
    ...(['PAID','PAYMENT_REVIEW'].includes(status) ? { paidAt: now } : {}),
    ...(status === 'TICKETED' ? { ticket: 'DEMO-DOCUMENT-' + value.id.slice(-8) } : {}),
    history: [...value.history, { at: now, text }] };
}
export function updateDemoBooking(id: string, action: DemoBookingAction, store = storage(), now = Date.now()): DemoBooking {
  const values = readDemoBookings(store); const index = values.findIndex(value => value.id === id);
  if (index < 0) throw new Error('This demo booking is not saved in this browser tab.');
  const next = transitionDemoBooking(values[index]!, action, now);
  values[index] = next; save(values, store); return next;
}
export function demoBookingReceipt(value: DemoBooking): string {
  if (!value.paidAt || !['PAID','PAYMENT_REVIEW','TICKETED','REFUNDED'].includes(value.status)) throw new Error('A demo receipt is available after successful demo payment.');
  return ['FLYSERI DEMO PAYMENT RECEIPT · NOT PROOF OF PAYMENT', value.id, `DAC → ${value.destination} · ${value.departure}`, `${value.travellers} sample traveller(s)`, `Simulated total: ${value.currency} ${(value.amountPerPerson * value.travellers).toFixed(2)}`, `Demo status: ${value.status}`, `Simulated approval: ${new Date(value.paidAt).toISOString()}`, 'No money was collected. No airline reservation or valid ticket exists.'].join('\n');
}
