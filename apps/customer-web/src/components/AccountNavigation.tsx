import { NavLink } from 'react-router-dom';

const links = [
  ['My Trips', 'trips', 'M3 7h18v14H3zM8 7V4h8v3M3 12h18'],
  ['My Bookings', 'bookings', 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4'],
  ['My Orders', 'orders', 'M6 3h12v18H6zM9 8h6M9 12h6M9 16h4'],
  ['Visa', 'visa', 'M6 3h12v18H6zM9 7h6M9 17h6M12 10v4M10 12h4'],
  ['My Documents', 'documents', 'M5 3h9l5 5v13H5zM14 3v5h5M8 12h8M8 16h6'],
  ['Travellers', 'travellers', 'M15 8a3 3 0 1 1-6 0 3 3 0 0 1 6 0ZM5 21v-3a7 7 0 0 1 14 0v3'],
  ['Payments', 'payments', 'M3 5h18v14H3zM3 9h18M7 15h3'],
  ['Ask Seri', 'seri', 'M12 3l2.5 6.5L21 12l-6.5 2.5L12 21l-2.5-6.5L3 12l6.5-2.5z'],
  ['Price alerts', 'price-alerts', 'M18 8a6 6 0 0 0-12 0c0 7-3 7-3 9h18c0-2-3-2-3-9M10 21h4'],
  ['Support', 'support', 'M4 14v-3a8 8 0 0 1 16 0v7h-4v-6h4M4 12h4v6H4zM16 21h-4'],
  ['Profile', 'profile', 'M16 7a4 4 0 1 1-8 0 4 4 0 0 1 8 0ZM4 21a8 8 0 0 1 16 0'],
] as const;

export function AccountNavigation() {
  return <nav aria-label="Account navigation">{links.map(([label, route, path]) =>
    <NavLink key={route} to={`/app/${route}`}>
      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d={path}/></svg>
      <span>{label}</span>
    </NavLink>
  )}</nav>;
}
