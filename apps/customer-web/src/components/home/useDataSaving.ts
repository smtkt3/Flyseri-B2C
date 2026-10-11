import { useEffect, useState } from 'react';
type Connection = EventTarget & { saveData?: boolean; effectiveType?: string };
const connection = () => (navigator as Navigator & { connection?: Connection }).connection;
const constrained = () => { const network = connection(); return !!network?.saveData || ['slow-2g', '2g'].includes(network?.effectiveType ?? ''); };

export function useDataSaving() {
  const [saving, setSaving] = useState(constrained);
  useEffect(() => {
    const network = connection();
    const update = () => setSaving(constrained());
    network?.addEventListener('change', update);
    return () => network?.removeEventListener('change', update);
  }, []);
  return saving;
}
