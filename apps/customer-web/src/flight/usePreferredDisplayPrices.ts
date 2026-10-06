import { useEffect, useState } from 'react';
import { currencyPreferenceEvent, preferredCurrency } from '../components/LocaleMenu';
import { flightService } from '../services/flightService';

/** Converts presentation amounts only; airline quotes retain their original currency. */
export function usePreferredDisplayPrices(prices: { amount: string | null; currency: string }[]) {
  const [currency, setCurrency] = useState(preferredCurrency);
  const key = JSON.stringify([currency, prices]);
  const [result, setResult] = useState<{ key: string; prices: (string | null)[]; provider: string | null } | null>(null);
  const [failedKey, setFailedKey] = useState<string | null>(null);
  useEffect(() => {
    const update = (event: Event) => {
      const value = (event as CustomEvent<string>).detail;
      setCurrency(typeof value === 'string' && /^[A-Z]{3}$/.test(value) ? value : preferredCurrency());
    };
    window.addEventListener(currencyPreferenceEvent, update);
    window.addEventListener('storage', update);
    return () => { window.removeEventListener(currencyPreferenceEvent, update); window.removeEventListener('storage', update); };
  }, []);
  useEffect(() => {
    const [target, values] = JSON.parse(key) as [string, typeof prices];
    if (!values.some(price => price.amount !== null && price.currency !== target && Number(price.amount) !== 0)) return;
    let active = true;
    void flightService.ancillaryDisplayPrices(values, target).then(data => {
      if (active) { setResult({ key, prices: data.prices, provider: data.provider }); setFailedKey(null); }
    }, () => { if (active) setFailedKey(key); });
    return () => { active = false; };
  }, [key]);
  return {
    currency,
    failed: failedKey === key,
    provider: result?.key === key ? result.provider : null,
    prices: prices.map((price, index) => ({
      amount: price.amount === null ? null : Number(price.amount) === 0 ? '0' : price.currency === currency ? price.amount : result?.key === key ? result.prices[index] ?? null : null,
      estimated: price.currency !== currency && Number(price.amount) !== 0,
    })),
  };
}
