import { useEffect, useState } from 'react';

export function NetworkStatus() {
  const [offline, setOffline] = useState(() => navigator.onLine === false);
  useEffect(() => {
    const update = () => setOffline(navigator.onLine === false);
    window.addEventListener('online', update);
    window.addEventListener('offline', update);
    return () => { window.removeEventListener('online', update); window.removeEventListener('offline', update); };
  }, []);
  return offline ? <aside className="network-status" role="status">You’re offline. Keep this page open and reconnect before searching, reserving or paying. Check your booking status before retrying a payment.</aside> : null;
}
