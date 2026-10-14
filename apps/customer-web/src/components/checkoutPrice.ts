/** An unavailable price must never become a zero or NaN checkout total. */
export function checkoutPrice(amount: unknown, currency: unknown): string | null {
  if ((typeof amount !== 'string' && typeof amount !== 'number') || String(amount).trim() === '' || typeof currency !== 'string' || !/^[A-Z]{3}$/.test(currency)) return null;
  const value = Number(amount);
  if (!Number.isFinite(value) || value < 0) return null;
  try { return new Intl.NumberFormat('en', { style: 'currency', currency }).format(value); }
  catch { return null; }
}
