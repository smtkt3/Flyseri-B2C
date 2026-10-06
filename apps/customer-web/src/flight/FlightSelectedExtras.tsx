import { useEffect, useState } from 'react';
import type { FlightAncillaryRequest, FlightAncillaryDisplayPrices } from '@flyseri/types';
import { preferredCurrency, currencyPreferenceEvent } from '../components/LocaleMenu';
import { flightService } from '../services/flightService';
import './FlightAirlineServices.css';

const money = (value: string | number, currency: string) => new Intl.NumberFormat('en-MY', { style: 'currency', currency, currencyDisplay: 'code' }).format(Number(value));
export function FlightSelectedExtras({ requests, airfare, onEstimatedTripTotal }: { requests: FlightAncillaryRequest[]; airfare?: { amount: string; currency: string }; onEstimatedTripTotal?: (total: {amount:number;currency:string}|null) => void }) {
  const [currency, setCurrency] = useState(preferredCurrency);
  const prices = [...requests.map(({ amount, currency }) => ({ amount, currency })), ...(airfare ? [airfare] : [])];
  const key = JSON.stringify([currency, prices]);
  const [converted, setConverted] = useState<{ key: string; data: FlightAncillaryDisplayPrices } | null>(null);
  useEffect(() => {
    const update = () => setCurrency(preferredCurrency());
    window.addEventListener(currencyPreferenceEvent, update); window.addEventListener('storage', update);
    return () => { window.removeEventListener(currencyPreferenceEvent, update); window.removeEventListener('storage', update); };
  }, []);
  useEffect(() => {
    if (!requests.length || !prices.some(price => price.amount !== null && price.currency && price.currency !== currency)) return;
    let active = true;
    void flightService.ancillaryDisplayPrices(prices, currency).then(data => { if (active) setConverted({ key, data }); }, () => { if (active) setConverted(null); });
    return () => { active = false; };
    // Values, rather than array identities, define this display-only request.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [key]);
  const amounts = prices.map((price, index) => price.amount === null || !price.currency ? null : Number(price.amount) === 0 ? '0' : price.currency === currency ? price.amount : converted?.key === key ? converted.data.prices[index] : null);
  const extrasTotal = amounts.slice(0, requests.length).every(amount => amount !== null) ? amounts.slice(0, requests.length).reduce((total, amount) => total + Number(amount), 0) : null;
  const fare = airfare ? amounts.at(-1) : null;
  const estimatedTripTotal = requests.length && extrasTotal !== null && fare !== null ? {amount:Number(fare)+extrasTotal,currency} : null;
  useEffect(()=>{onEstimatedTripTotal?.(estimatedTripTotal);},[onEstimatedTripTotal,estimatedTripTotal?.amount,estimatedTripTotal?.currency]);
  if (!requests.length) return null;
  return <section className="flight-selected-extras" aria-label="Selected airline extras">
    <h3>Selected extras <span>{requests.length}</span></h3>
    {requests.map((extra, index) => <div className="flight-selected-extra" key={extra.id}><div><strong>{extra.name}</strong><small>{extra.segmentLabels.join(' / ')}</small><small>Traveler {extra.passengerIndexes.map(index => index + 1).join(', ')}</small></div><span>{amounts[index] !== null ? `${extra.currency !== currency && Number(extra.amount) !== 0 ? '≈ ' : ''}${money(amounts[index]!, currency)}` : 'Price needs confirmation'}</span></div>)}
    <div className="flight-selected-extra-total"><span>Estimated extras</span><strong>{extrasTotal !== null ? `≈ ${money(extrasTotal, currency)}` : 'Awaiting prices'}</strong></div>
    {airfare && extrasTotal !== null && fare !== null && <div className="flight-selected-extra-total"><span>Estimated trip with extras</span><strong>≈ {money(Number(fare) + extrasTotal, currency)}</strong></div>}
    <p>Selected for your booking as requests. Airline confirmation and final charges are pending; these extras are not purchased or included in the amount payable.</p>
    {converted?.key === key && converted.data.provider && <p>Converted estimates · <a href="https://www.exchangerate-api.com" target="_blank" rel="noreferrer">Rates by ExchangeRate-API</a></p>}
  </section>;
}
