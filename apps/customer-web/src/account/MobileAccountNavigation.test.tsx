// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { cleanup, render, screen } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { MobileAccountNavigation } from './MobileAccountNavigation';
afterEach(cleanup);
describe('mobile account navigation',()=>{
  it('shows five clear destinations with matching SVG icons and correct links',()=>{
    render(<MemoryRouter initialEntries={['/app']}><MobileAccountNavigation/></MemoryRouter>);
    const links=screen.getAllByRole('link');
    expect(links.map(link=>link.textContent)).toEqual(['Home','Search','My travel','Rewards','Account']);
    expect(links.map(link=>link.getAttribute('href'))).toEqual(['/app','/app/flights','/app/bookings','/app/points','/app/profile']);
    expect(links.every(link=>link.querySelector('svg'))).toBe(true);
    expect(links.filter(link=>link.getAttribute('aria-current')==='page')).toHaveLength(1);
  });
  it.each(['/app/trips/trip-a','/app/orders/order-a','/app/bookings/booking-a','/app/payments'])('keeps My travel active on %s',path=>{
    render(<MemoryRouter initialEntries={[path]}><MobileAccountNavigation/></MemoryRouter>);
    expect(screen.getByRole('link',{name:'My travel'}).getAttribute('aria-current')).toBe('page');
    expect(screen.getByRole('link',{name:'Home'}).getAttribute('aria-current')).toBeNull();
  });
  it.each(['/app/profile?section=documents','/app/documents/document-a','/app/travellers'])('keeps Account active on %s',path=>{
    render(<MemoryRouter initialEntries={[path]}><MobileAccountNavigation/></MemoryRouter>);
    expect(screen.getByRole('link',{name:'Account'}).getAttribute('aria-current')).toBe('page');
  });
});
