import type { FlightOffer } from '@flyseri/types';
import { legsOf, penaltySummary } from './flightPresentation';
import { airlineBaggageLimit } from './airlineBaggagePolicy';

const availability = { INCLUDED: 'Included', FOR_FEE: 'Available for a fee', NOT_INCLUDED: 'Not included', UNKNOWN: 'Not specified' };
const applies = (indexes: number[] | undefined, index: number) => !indexes?.length || indexes.includes(index);
const iconPaths: Record<string, string> = {
  personal: 'M7 7V5a5 5 0 0 1 10 0v2M5 7h14v14H5zM5 12h14',
  carry: 'M8 6V3h8v3M5 6h14v14H5zM8 20v2M16 20v2M9 10v6M15 10v6',
  checked: 'M8 5V2h8v3M5 5h14v15H5zM8 20v2M16 20v2M8 13l3 3 5-6',
  rules: 'M4 8a8 8 0 1 1-1 8M4 3v5h5',
  info: 'M12 10v7M12 6v1M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20',
  meals: 'M4 2v7h6V2M7 2v20M18 2v20M18 2c-5 4-5 10 0 10',
  wifi: 'M2 8a16 16 0 0 1 20 0M5 12a11 11 0 0 1 14 0M9 16a5 5 0 0 1 6 0M12 20h.01',
  entertainment: 'M3 3h18v14H3zM8 21h8M12 17v4M10 7l5 3-5 3z',
};

/** Combine benefits only when the airline reports the same allowance on every flight. */
export function FlightFareSummary({ offer }: { offer: FlightOffer }) {
  const segments = legsOf(offer).flatMap(leg => leg.segments);
  const rows: { icon: string; label: string; value: string }[] = [];
  for (const [type, label, icon] of [['PERSONAL_ITEM', 'Personal item', 'personal'], ['CARRY_ON', 'Carry-on baggage', 'carry'], ['CHECKED', 'Checked baggage', 'checked']] as const) {
    const perFlight = segments.map((_, index) => [...new Set((offer.baggageAllowances ?? [])
      .filter(item => item.type === type && item.availability !== 'UNKNOWN' && applies(item.segmentIndexes, index))
      .map(item => {
        const policy=airlineBaggageLimit(offer,item);
        const text=item.description ? item.availability === 'INCLUDED' ? item.description : `${availability[item.availability]} · ${item.description}` : availability[item.availability];
        return text+(policy?` · up to ${policy.kg} kg ${policy.basis} (airline policy)`:'');
      }))].sort().join(' / '));
    if (!perFlight.some(Boolean)) continue;
    rows.push({ icon, label, value: perFlight.every(value => value && value === perFlight[0]) ? perFlight[0]! : 'Varies by flight — see details' });
  }
  for (const type of ['REFUND', 'CHANGE'] as const) {
    for (const value of penaltySummary(offer, type)) rows.push({ icon: 'rules', label: '', value });
  }
  if ((offer.penalties ?? []).some(rule => rule.type === 'CHANGE' && rule.allowed)) rows.push({ icon: 'info', label: '', value: 'Fare difference may apply' });
  for (const [category, label, icon] of [['MEALS', 'Meals', 'meals'], ['WIFI', 'Wi-Fi', 'wifi'], ['ENTERTAINMENT', 'Entertainment', 'entertainment']] as const) {
    const perFlight = segments.map((_, index) => [...new Set((offer.amenities ?? [])
      .filter(item => item.category === category && item.availability !== 'UNKNOWN' && applies(item.segmentIndexes, index))
      .map(item => availability[item.availability]))].sort().join(' / '));
    if (!perFlight.some(Boolean)) continue;
    rows.push({ icon, label, value: perFlight.every(value => value && value === perFlight[0]) ? perFlight[0]! : 'Varies by flight — see details' });
  }
  return <ul className="flight-fare-compact-benefits" aria-label="Fare benefits">{rows.map((row, index) => <li key={index}><span aria-hidden="true"><svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round"><path d={iconPaths[row.icon]}/></svg></span><span>{row.label && <>{row.label}: </>}{row.value}</span></li>)}</ul>;
}
