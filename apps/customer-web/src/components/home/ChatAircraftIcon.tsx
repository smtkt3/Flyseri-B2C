import { useId } from 'react';

/** Vector airliner: swept wings, underwing engines, cockpit and blue tail livery. */
export function ChatAircraftIcon() {
  const id = useId().replace(/:/g, '');
  return <svg className="seri-launcher-aircraft" viewBox="0 0 80 80" fill="none" aria-hidden="true">
    <defs>
      <linearGradient id={`${id}-body`} x1="34" y1="40" x2="46" y2="40" gradientUnits="userSpaceOnUse"><stop stopColor="#93b4cd"/><stop offset=".35" stopColor="#f8fcff"/><stop offset=".62" stopColor="white"/><stop offset="1" stopColor="#a9c4d9"/></linearGradient>
      <linearGradient id={`${id}-wing`} x1="10" y1="30" x2="68" y2="55" gradientUnits="userSpaceOnUse"><stop stopColor="#dceaf4"/><stop offset=".48" stopColor="#fff"/><stop offset="1" stopColor="#87abc9"/></linearGradient>
      <linearGradient id={`${id}-blue`} x1="35" y1="50" x2="45" y2="74" gradientUnits="userSpaceOnUse"><stop stopColor="#50bcf3"/><stop offset="1" stopColor="#1769d8"/></linearGradient>
    </defs>
    <g transform="rotate(30 40 40)" strokeLinejoin="round">
      <path d="M36 29 8 48 7 54 35 45 37 60 25 69 25 73 40 68 55 73 55 69 43 60 45 45 73 54 72 48 44 29Z" fill={`url(#${id}-wing)`} stroke="#7298bb" strokeWidth=".8"/>
      <path d="m8 48-2 4 1 3 4-1 1-6M72 48l2 4-1 3-4-1-1-6" fill="#2084e8"/>
      <path d="m11 50 23-10m12 0 23 10M28 69l9-5m6 0 9 5" stroke="#789ab8" strokeWidth=".65"/>
      <g fill={`url(#${id}-body)`} stroke="#6e94b7" strokeWidth=".7">
        <path d="M23 37q0-3 3-3t3 3v12q-3 3-6 0Z"/><path d="M51 37q0-3 3-3t3 3v12q-3 3-6 0Z"/>
      </g>
      <path d="M23.5 37q2.5-2 5 0m23 0q2.5-2 5 0" stroke="#244d6b" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M24 49h4m24 0h4" stroke="#5f8ba9" strokeWidth="1.8" strokeLinecap="round"/>
      <path d="M40 4c-4.2 2.5-5.3 7.6-5.3 14.5l.6 31.5c.1 8 2 16.2 4.7 22 2.7-5.8 4.6-14 4.7-22l.6-31.5C45.3 11.6 44.2 6.5 40 4Z" fill={`url(#${id}-body)`} stroke="#7098b9" strokeWidth=".8"/>
      <path d="M36.4 15.6q3.6-3.5 7.2 0l-.5 2.2q-3.1-1.7-6.2 0Z" fill="#234967"/>
      <path d="M39.8 14.3v2.5" stroke="#c9e7f8" strokeWidth=".6"/>
      <path d="M40 51.5 36.8 65 40 72l3.2-7Z" fill={`url(#${id}-blue)`}/>
      <path d="M40 53v16" stroke="#8addff" strokeWidth=".7"/>
      {[22,26,30,34,38,42,46].map(y=><g key={y} fill="#48738f"><rect x="35.7" y={y} width="1" height="1.5" rx=".4"/><rect x="43.3" y={y} width="1" height="1.5" rx=".4"/></g>)}
      <path d="M38 8q-1.5 4-1.5 6" stroke="white" strokeWidth=".9" strokeLinecap="round"/>
      <circle cx="7.5" cy="53" r=".8" fill="#ff675d"/><circle cx="72.5" cy="53" r=".8" fill="#5ad9b8"/>
    </g>
  </svg>;
}
