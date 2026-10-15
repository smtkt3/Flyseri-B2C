const redirectKey = 'flyseri.auth.return';

/** Only known application routes may receive an authenticated redirect. */
export function safeAuthReturn(value: unknown, fallback = '/app'): string {
  if (typeof value !== 'string' || value.length > 4096 || /[\\\u0000-\u0020]/.test(value)) return fallback;
  if (!/^\/(?:app(?:\/|\?|$)|flights(?:\?|$)|flight-checkout(?:\?|$)|holidays(?:\/|\?|$)|$)/.test(value)) return fallback;
  try { const parsed = new URL(value, window.location.origin); return parsed.origin === window.location.origin ? value : fallback; }
  catch { return fallback; }
}

export function rememberAuthReturn(value: string): void {
  try { sessionStorage.setItem(redirectKey, JSON.stringify({path: safeAuthReturn(value), expires: Date.now()+30*60_000})); }
  catch { /* Authentication can still complete when browser storage is restricted. */ }
}

export function consumeAuthReturn(): string {
  try {
    const stored = sessionStorage.getItem(redirectKey);
    sessionStorage.removeItem(redirectKey);
    const item = stored ? JSON.parse(stored) : null;
    return item && typeof item.expires === 'number' && item.expires > Date.now() ? safeAuthReturn(item.path) : '/app';
  } catch { return '/app'; }
}
