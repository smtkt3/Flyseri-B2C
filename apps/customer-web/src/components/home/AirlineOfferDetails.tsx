import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Link } from 'react-router-dom';
import { homeSearchUrl, updateHomeSearch, useHomeSearchDraft } from './homeSearchDraft';

export type HomeAirlineOffer = { city: string; code: string; airline: string; name: string; price: string; published?: boolean; baggage?: string; availableSeats?: number; departureDates?: string[] };
export function AirlineOfferDetails({ offer, onClose }: { offer: HomeAirlineOffer; onClose: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const search = useHomeSearchDraft();
  const origin = "DAC";
  const today = new Date();
  const minimumDate = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`;
  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    dialog.current?.showModal();
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => { document.body.style.overflow = previousOverflow; previous?.focus({ preventScroll: true }); };
  }, []);
  return createPortal(<dialog ref={dialog} className="home-offer-dialog" aria-labelledby="home-offer-title" onCancel={onClose} onClick={event => { if (event.target === event.currentTarget) { const rect = event.currentTarget.getBoundingClientRect(); if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) onClose(); } }}>
    <div className="home-offer-heading"><img src={'/airlines/' + offer.airline + '.png'} alt={offer.name}/><div><h2 id="home-offer-title">{offer.city}</h2><p>{origin} → {offer.code} · {offer.name}</p></div><button type="button" aria-label="Close offer details" onClick={onClose}>×</button></div>
    {!offer.published && <p className="home-offer-sample">Sample offer · not bookable. Search live flights for confirmed options.</p>}
    <dl><div><dt>{offer.published ? 'Advertised fare' : 'Sample adult fare'}</dt><dd>BDT {offer.price}</dd></div><div><dt>Checked baggage</dt><dd>{offer.baggage ?? 'Confirm with the selected fare'}</dd></div><div><dt>Availability</dt><dd>{offer.availableSeats === undefined ? 'Check live availability' : `${offer.availableSeats} advertised seats · reconfirm before booking`}</dd></div></dl>
    {offer.departureDates?.length ? <label className="home-offer-date-select">Departure<select value={offer.departureDates.includes(search.departure) ? search.departure : ''} onChange={event => updateHomeSearch({ departure: event.target.value })}><option value="">Choose date</option>{offer.departureDates.filter(date => date >= minimumDate).map(date => <option key={date} value={date}>{date}</option>)}</select></label> : <label className="home-offer-date-select">Departure<input aria-label="Offer departure" type="date" value={search.departure} min={minimumDate} onChange={event => { const departure = event.target.value; updateHomeSearch({ departure, returnDate: search.returnDate && search.returnDate < departure ? "" : search.returnDate }); }}/></label>}
    <fieldset className="home-offer-pax"><legend>Travellers</legend>{([['adults', 'Adults', '12+ years', 1], ['children', 'Children', '2–11 years', 0], ['infants', 'Infants', 'Under 2 years', 0]] as const).map(([field, label, age, minimum]) => <label key={field}><span>{label}<small>{age}</small></span><input aria-label={`Offer ${label.toLowerCase()}`} type="number" value={search[field]} min={minimum} max={field === 'adults' ? 9 - search.children - search.infants : field === 'children' ? 9 - search.adults - search.infants : Math.min(search.adults, 9 - search.adults - search.children)} onChange={event => {
      const count = Number(event.target.value); if (!Number.isInteger(count) || count < minimum) return;
      const other = search.adults + search.children + search.infants - search[field];
      if (count + other > 9 || (field === 'infants' && count > search.adults)) return;
      updateHomeSearch({ [field]: count, ...(field === 'adults' && count < search.infants ? { infants: count } : {}) });
    }}/></label>)}</fieldset>
    <Link className="home-offer-search" to={homeSearchUrl({ ...search, origin, mode: 'ONE_WAY' }, offer.code)} onClick={() => { updateHomeSearch({ origin, destination: offer.code, mode: 'ONE_WAY' }); onClose(); }}>Search live flights ↗</Link>
  </dialog>, document.body);
}
