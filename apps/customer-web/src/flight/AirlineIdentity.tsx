import { useState } from 'react';
import airlineDirectory from './data/airlines.json';

type Airline = { name: string; logo?: string };
const airlines = airlineDirectory as Record<string, Airline>;

export function airlineName(code: string) {
  return airlines[code]?.name ?? null;
}

export function AirlineIdentity({ codes }: { codes: string[] }) {
  if (!codes.length) return <span className="airline-unknown">Airline details unavailable</span>;
  return <div className="airline-list">{codes.map((code) => <AirlineMark key={code} code={code} />)}</div>;
}

function AirlineMark({ code }: { code: string }) {
  const [logoFailed, setLogoFailed] = useState(false);
  const airline = airlines[code];
  return <span className="airline-identity">
    <span className="airline-logo">{airline?.logo && !logoFailed
      ? <img src={airline.logo} alt="" loading="lazy" onError={() => setLogoFailed(true)} />
      : <span aria-hidden="true">{code}</span>}</span>
    <span className="airline-copy"><strong>{airline?.name ?? 'Airline'}</strong><small>{airline ? `(${code})` : `Code ${code}`}</small></span>
  </span>;
}
