import { useEffect, useState } from 'react';

/** The server remains authoritative; prevent submitting an obviously stale fare. */
export function useFareExpiry(expiresAt: string | null | undefined) {
  const [now, setNow] = useState(Date.now);
  useEffect(() => {
    setNow(Date.now());
    if (!expiresAt) return;
    const timer = window.setInterval(() => setNow(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, [expiresAt]);
  const deadline = expiresAt ? Date.parse(expiresAt) : NaN;
  const seconds = Number.isFinite(deadline) ? Math.max(0, Math.ceil((deadline - now) / 1000)) : 0;
  return { expired: seconds === 0, remaining: `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}` };
}
