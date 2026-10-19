import { useState } from 'react';
import { Link } from 'react-router-dom';
import './flight-search-start.css';

const routeShortcuts = [
  { city: "Cox’s Bazar", code: 'CXB', country: 'Bangladesh', domestic: true },
  { city: 'Chattogram', code: 'CGP', country: 'Bangladesh', domestic: true },
  { city: 'Bangkok', code: 'BKK', country: 'Thailand', domestic: false },
  { city: 'Kuala Lumpur', code: 'KUL', country: 'Malaysia', domestic: false },
  { city: 'Singapore', code: 'SIN', country: 'Singapore', domestic: false },
  { city: 'Dubai', code: 'DXB', country: 'United Arab Emirates', domestic: false },
];

export function FlightSearchHeading() {
  return <header className="flight-start-heading">
    <div><h1>Flights</h1><p>Find a flight that fits your plans.</p></div>
    <Link to="/app/bookings" className="flight-start-bookings"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" aria-hidden="true"><rect x="4" y="6" width="16" height="15" rx="2"/><path d="M9 6V4h6v2M4 11h16M9 14h6"/></svg>Manage booking<span aria-hidden="true">→</span></Link>
  </header>;
}

export function FlightSearchStart({ onChooseRoute, selectedOrigin, selectedDestination }: {
  onChooseRoute: (city: string, code: string) => void;
  selectedOrigin: string;
  selectedDestination: string;
}) {
  const [region, setRegion] = useState<'all' | 'domestic' | 'international'>('all');
  const [announcement, setAnnouncement] = useState('');
  return <div className="flight-start-content">
    <section className="flight-start-routes" aria-labelledby="flight-route-shortcuts">
      <div className="flight-start-section-head">
        <div><h2 id="flight-route-shortcuts">Start with a route</h2><p>Shortcuts from Dhaka. Choose your dates to see available flights.</p></div>
        <div className="flight-start-regions" role="group" aria-label="Filter route shortcuts">
          {([{ value: 'all', label: 'All routes' }, { value: 'domestic', label: 'Domestic' }, { value: 'international', label: 'International' }] as const).map(option => <button key={option.value} type="button" aria-pressed={region === option.value} onClick={() => setRegion(option.value)}>{option.label}</button>)}
        </div>
      </div>
      <div className="flight-start-route-grid">
        {routeShortcuts.filter(route => region === 'all' || route.domestic === (region === 'domestic')).map(route => {
          const selected = selectedOrigin === 'DAC' && selectedDestination === route.code;
          return <button className="flight-start-route" key={route.code} type="button" aria-label={`Choose Dhaka to ${route.city}`} aria-pressed={selected} onClick={() => { onChooseRoute(route.city, route.code); setAnnouncement(`Dhaka to ${route.city} selected. Choose your travel dates above.`); }}>
            <span className="flight-start-route-icon" aria-hidden="true"><svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5"><path d="m21 3-6 18-4-8-8-4 18-6ZM11 13 21 3"/></svg></span>
            <span className="flight-start-route-copy"><strong>{route.city}</strong><small>{route.country}</small></span>
            <span className="flight-start-route-code">DAC <span aria-hidden="true">→</span> {route.code}</span>
          </button>;
        })}
      </div>
      <p className="sr-only" role="status">{announcement}</p>
    </section>
    <section className="flight-start-guide" aria-labelledby="flight-before-booking">
      <div className="flight-start-guide-heading"><h2 id="flight-before-booking">Before you book</h2><Link to="/help">Get help <span aria-hidden="true">↗</span></Link></div>
      <div className="flight-start-guide-grid">
        <details><summary>Baggage &amp; connections<span aria-hidden="true">+</span></summary><p>Check the allowance on your chosen fare. On a self-transfer, you may need to collect and check in your bags again, and meet the connecting country’s entry requirements.</p></details>
        <details><summary>Changes &amp; refunds<span aria-hidden="true">+</span></summary><p>Read the fare rules before booking. A change or refund can include airline penalties, a fare difference and applicable service fees.</p></details>
        <details><summary>Passports &amp; visas<span aria-hidden="true">+</span></summary><p>Check entry and transit requirements for your passport, route and travel dates. Airport changes or baggage collection may require passing immigration.</p><Link to="/app/visa">Explore visa guides →</Link></details>
      </div>
    </section>
  </div>;
}
