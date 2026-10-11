import { Chevron } from '../components/Chevron';
import type { FlightLeg } from '@flyseri/types';

export function flightElapsedMinutes(departure: string, arrival: string): number | null {
  // Only calculate across time zones when both supplier timestamps include offsets.
  if (![departure, arrival].every(value => /(?:Z|[+-]\d{2}:\d{2})$/.test(value))) return null;
  const elapsed = (Date.parse(arrival) - Date.parse(departure)) / 60000;
  return Number.isFinite(elapsed) && elapsed > 0 ? Math.round(elapsed) : null;
}
function duration(value: number | null | undefined) {
  return value != null && Number.isFinite(value) && value > 0 ? `${Math.floor(value / 60)}h ${Math.round(value % 60)}m` : 'Duration unavailable';
}
function localDate(value: string) {
  const date = new Date(value.slice(0, 10) + 'T12:00:00Z');
  return Number.isFinite(date.getTime()) ? new Intl.DateTimeFormat('en', {weekday:'short',day:'numeric',month:'short',year:'numeric',timeZone:'UTC'}).format(date) : 'Date unavailable';
}
function offset(value: string) {
  const match = value.match(/(Z|[+-]\d{2}:\d{2})$/)?.[1];
  return match ? match === 'Z' ? 'UTC' : `UTC${match}` : '';
}
export function ReviewFlightLeg({leg, title}: {leg:FlightLeg;title:string}) {
  const first = leg.segments[0], last = leg.segments.at(-1);
  if (!first || !last) return null;
  const elapsed = leg.durationMinutes ?? flightElapsedMinutes(first.departureAt, last.arrivalAt);
  const differentDate = first.departureAt.slice(0,10) !== last.arrivalAt.slice(0,10);
  return <article className="flight-review-leg">
    <div className="flight-review-leg-title"><strong>{title}</strong><span>{localDate(first.departureAt)}</span></div>
    <div className="flight-review-route">
      <div><small className="review-time-label">Departure</small><strong>{first.origin}</strong><span>{first.departureAt.slice(11,16)}</span><small className="review-local-date">{localDate(first.departureAt)}</small><small className="review-time-zone">Local time {offset(first.departureAt)}</small></div>
      <div className="flight-review-route-line"><span aria-hidden="true">✈</span><b className="review-duration">{duration(elapsed)}</b><small>{leg.segments.length === 1 ? 'Nonstop' : `${leg.segments.length - 1} ${leg.segments.length === 2 ? 'stop' : 'stops'}`}</small>{leg.segments.length > 1 && <small>via {leg.segments.slice(0,-1).map(segment => segment.destination).join(', ')}</small>}</div>
      <div><small className="review-time-label">Arrival</small><strong>{last.destination}</strong><span>{last.arrivalAt.slice(11,16)}</span><small className="review-local-date">{localDate(last.arrivalAt)}</small><small className="review-time-zone">Local time {offset(last.arrivalAt)}</small>{differentDate && <small className="review-arrival-day">Arrives on a different day</small>}</div>
    </div>
    <div className="review-leg-footer"><span>{leg.segments.map(segment => `${segment.marketingCarrier} ${segment.flightNumber}`).join(' · ')}</span><span>All times local to each airport</span></div>
    <details className="review-segment-details"><summary>Flight details <span aria-hidden="true"><Chevron/></span></summary>
      {leg.segments.map((segment,index) => <div key={index}>
        <section className="review-segment"><strong>{segment.origin} → {segment.destination}</strong><span>{segment.marketingCarrier} {segment.flightNumber} · {duration(segment.durationMinutes ?? flightElapsedMinutes(segment.departureAt,segment.arrivalAt))}</span><p>{localDate(segment.departureAt)} · {segment.departureAt.slice(11,16)} {offset(segment.departureAt)}<br/>{localDate(segment.arrivalAt)} · {segment.arrivalAt.slice(11,16)} {offset(segment.arrivalAt)}</p>{segment.operatingCarrier && segment.operatingCarrier !== segment.marketingCarrier && <small>Operated by {segment.operatingCarrier}</small>}{segment.aircraftTypeCode && <small>Aircraft code: {segment.aircraftTypeCode}</small>}</section>
        {leg.segments[index+1] && <p className="review-layover">Connection in {segment.destination} · {duration(flightElapsedMinutes(segment.arrivalAt,leg.segments[index+1]!.departureAt))}</p>}
      </div>)}
    </details>
  </article>;
}
