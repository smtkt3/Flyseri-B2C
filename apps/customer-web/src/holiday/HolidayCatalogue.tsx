import { Link, useSearchParams } from 'react-router-dom';
import { PageLoading } from '../components/PageLoading';
import type { HolidayPackage } from '@flyseri/types';
import { BoundedSelect } from '../components/BoundedSelect';
import { useHolidayPackages } from './HolidayPackages';
import { holidayMoney } from './holidayService';
import './holiday-catalogue.css';

const countries = new Intl.DisplayNames(['en'], { type: 'region' });
const countryName = (code: string) => { try { return countries.of(code) ?? code; } catch { return code; } };
const searchable = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[’']/g, '').toLowerCase();
const durations = [{ value: 'any', label: 'Any duration' }, { value: 'short', label: '1–3 days' }, { value: 'medium', label: '4–6 days' }, { value: 'long', label: '7+ days' }];
const baseSorts = [{ value: 'default', label: 'Default order' }, { value: 'shortest', label: 'Shortest trips first' }, { value: 'longest', label: 'Longest trips first' }, { value: 'name', label: 'Destination A–Z' }];

function PackageCard({ item, search }: { item: HolidayPackage; search: string }) {
  const preview = !!item.preview;
  return <article className="package-card">
    <Link className="package-card-link" to={`/holidays/${item.id}`} state={{ holidayCatalogueSearch: search }} aria-label={`${preview ? 'Preview itinerary' : 'View package'} for ${item.location}: ${item.title}`}>
    <div className="package-card-cover">
      <img src={item.imageUrl} alt={item.location} loading="lazy" decoding="async" />
      <span className="package-card-country">{countryName(item.countryCode)}</span>
      <span className="package-card-place">{item.location}</span>
      <span className="package-card-duration">{item.days} days · {item.nights} nights</span>
      {preview && <span className="package-card-preview">Sample itinerary</span>}
    </div>
    <div className="package-card-content">
      <h2>{item.title}</h2>
      <ul className="package-card-inclusions" aria-label={`${preview ? 'Sample inclusions' : 'Included'} for ${item.location}`}>
        {item.inclusions.slice(0, 2).map((inclusion, index) => <li key={index}><span aria-hidden="true">✓</span>{inclusion}</li>)}
      </ul>
      <div className="package-card-bottom">
        <div>{preview ? <span className="package-card-price-note">Inspiration only<br />Not available to book</span> : <><span className="package-card-price-note">From / adult</span><strong>{holidayMoney(item.adultPrice)}</strong></>}</div>
        <span className="package-card-action">{preview ? 'View itinerary' : 'View package'} <span aria-hidden="true">→</span></span>
      </div>
    </div>
    </Link>
  </article>;
}

export function HolidayCatalogue() {
  const { packages, loading, failed, preview, retry } = useHolidayPackages();
  const [params, setParams] = useSearchParams();
  const query = (params.get('q') ?? '').slice(0, 100);
  const region = ['DOMESTIC', 'INTERNATIONAL'].includes(params.get('region') ?? '') ? params.get('region')! : 'ALL';
  const duration = durations.some(item => item.value === params.get('duration')) ? params.get('duration')! : 'any';
  const sortOptions = preview ? baseSorts : [...baseSorts, { value: 'price-low', label: 'Price: low to high' }, { value: 'price-high', label: 'Price: high to low' }];
  const sort = sortOptions.some(item => item.value === params.get('sort')) ? params.get('sort')! : 'default';
  function update(field: string, value: string) {
    const next = new URLSearchParams(params);
    if (!value || value === 'ALL' || value === 'any' || value === 'default') next.delete(field); else next.set(field, value);
    setParams(next, { replace: true });
  }
  const clearFilters = () => { const next = new URLSearchParams(params); ['q', 'region', 'duration'].forEach(key => next.delete(key)); setParams(next, { replace: true }); };
  const searchTerms = searchable(query.trim()).split(/\s+/).filter(Boolean);
  const filtered = packages.filter(item => (region === 'ALL' || item.category === region) &&
    (duration === 'any' || (duration === 'short' ? item.days <= 3 : duration === 'medium' ? item.days >= 4 && item.days <= 6 : item.days >= 7)) &&
    searchTerms.every(term => searchable(`${item.location} ${item.title} ${item.summary} ${countryName(item.countryCode)}`).includes(term)));
  const items = [...filtered].sort((a, b) => sort === 'shortest' ? a.days - b.days : sort === 'longest' ? b.days - a.days : sort === 'name' ? a.location.localeCompare(b.location) : sort === 'price-low' ? a.adultPrice - b.adultPrice : sort === 'price-high' ? b.adultPrice - a.adultPrice : 0);
  const hasFilters = !!query.trim() || region !== 'ALL' || duration !== 'any';
  const search = params.size ? `?${params}` : '';
  return <div className="package-catalogue">
    <header className="package-catalogue-heading"><div><h1>Holiday packages</h1><p>Find a getaway that fits your time and travel plans.</p></div><Link to="/holidays/bookings" className="package-manage-link"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="6" width="16" height="15" rx="2"/><path d="M9 6V3h6v3M4 12h16"/></svg>My bookings <span aria-hidden="true">→</span></Link></header>
    <section className="package-search-panel" aria-label="Find a holiday package">
      <div className="package-region-filter" role="group" aria-label="Package destinations">
        {([{ value: 'ALL', label: 'All trips' }, { value: 'DOMESTIC', label: 'Bangladesh' }, { value: 'INTERNATIONAL', label: 'International' }] as const).map(option => <button type="button" key={option.value} aria-pressed={region === option.value} onClick={() => update('region', option.value)}>{option.label}{!loading && <span>{packages.filter(item => option.value === 'ALL' || item.category === option.value).length}</span>}</button>)}
      </div>
      <div className="package-search-controls">
        <label className="package-search-field"><span>Destination or package</span><div><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><input type="search" value={query} maxLength={100} onChange={event => update('q', event.target.value)} placeholder="Try Bali, Sylhet or Maldives" aria-label="Search packages" />{query && <button type="button" onClick={() => update('q', '')} aria-label="Clear destination search">×</button>}</div></label>
        <div className="package-select-field"><span>Trip length</span><BoundedSelect value={duration} options={durations} placeholder="Any duration" ariaLabel="Trip length" onChange={value => update('duration', value)} /></div>
        <div className="package-select-field"><span>Sort by</span><BoundedSelect value={sort} options={sortOptions} placeholder="Default order" ariaLabel="Sort packages" onChange={value => update('sort', value)} /></div>
      </div>
    </section>
    {preview && <aside className="package-preview-notice" aria-label="Sample catalogue notice"><span className="package-notice-icon" aria-hidden="true">i</span><div><strong>{failed ? 'Live packages could not be loaded' : 'Destination inspiration'}</strong><p>These are sample itineraries. They are not available to book.</p></div>{failed && <button type="button" onClick={retry}>Try again</button>}</aside>}
    <div className="package-results-heading"><p role="status" aria-live="polite">{loading ? 'Loading packages…' : <><strong>{items.length}</strong> {preview ? items.length === 1 ? 'destination idea' : 'destination ideas' : items.length === 1 ? 'package' : 'packages'}{region !== 'ALL' ? ` · ${region === 'DOMESTIC' ? 'Bangladesh' : 'International'}` : ''}</>}</p>{hasFilters && <button type="button" onClick={clearFilters}>Clear filters</button>}</div>
    {hasFilters && <div className="package-active-filters" aria-label="Applied filters">{query.trim() && <button type="button" onClick={() => update('q', '')} aria-label="Remove search filter">“{query.trim()}” <span aria-hidden="true">×</span></button>}{duration !== 'any' && <button type="button" onClick={() => update('duration', 'any')} aria-label="Remove trip length filter">{durations.find(item => item.value === duration)!.label} <span aria-hidden="true">×</span></button>}</div>}
    {loading ? <><PageLoading label="Loading packages"/><div className="package-catalogue-grid package-catalogue-loading" aria-hidden="true">{[0, 1, 2, 3, 4, 5].map(index => <div key={index}><i/><span/><span/><span/></div>)}</div></> : items.length ? <div className="package-catalogue-grid">{items.map(item => <PackageCard key={item.id} item={item} search={search} />)}</div> : <section className="package-no-results"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><circle cx="10.5" cy="10.5" r="6.5"/><path d="m16 16 5 5"/></svg><h2>No trips match these filters</h2><p>Try another destination or a different trip length.</p><button type="button" onClick={clearFilters}>Clear filters</button></section>}
    <footer className="package-planning-help"><div><strong>Need help choosing a trip?</strong><p>Talk to our team about destinations, inclusions and travel arrangements.</p></div><Link to="/help#contact-support">Get planning help <span aria-hidden="true">↗</span></Link></footer>
  </div>;
}
