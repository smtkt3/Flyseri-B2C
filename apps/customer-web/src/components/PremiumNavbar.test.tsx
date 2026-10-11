// @vitest-environment jsdom
import {afterEach,describe,expect,it,vi} from 'vitest';
import {cleanup,fireEvent,render,screen,within,waitFor} from '@testing-library/react';
import {MemoryRouter} from 'react-router-dom';
import {PremiumNavbar} from './PremiumNavbar';
const auth=vi.hoisted(()=>({signOut:vi.fn()}));
vi.mock('../services/authService',()=>({authService:auth}));
vi.mock('../auth/AuthProvider',()=>({useAuth:()=>({session:null})}));
afterEach(cleanup);
describe('shared customer navbar',()=>{
 it('highlights the current account page and keeps icons decorative',()=>{render(<MemoryRouter initialEntries={['/app/documents']}><PremiumNavbar name="Shahid"/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'My Flyseri account'}));const menu=screen.getByRole('navigation',{name:'Account navigation'});expect(within(menu).getByRole('link',{name:'My Documents'}).getAttribute('aria-current')).toBe('page');expect(within(menu).getByRole('link',{name:'My Trips'}).getAttribute('aria-current')).toBeNull();expect(within(menu).getByRole('link',{name:'My Bookings'}).getAttribute('href')).toBe('/app/bookings');expect([...menu.querySelectorAll('svg')].every(icon=>icon.getAttribute('aria-hidden')==='true')).toBe(true);});
 it('keeps booking and support links available and opens travel services',()=>{
  render(<MemoryRouter initialEntries={['/app/visa']}><PremiumNavbar/></MemoryRouter>);
  const nav=screen.getByRole('navigation',{name:'Main navigation'});
  expect(within(nav).getByRole('link',{name:'Find bookings'}).getAttribute('href')).toBe('/app/bookings');
  expect(within(nav).getByRole('link',{name:'Customer support'}).getAttribute('href')).toBe('/app/support');
  expect(screen.getByRole('link',{name:/Sign in/}).getAttribute('href')).toBe('/sign-in');
  fireEvent.click(screen.getByRole('button',{name:'Open travel services'}));
  const drawer=screen.getByRole('dialog',{name:'Travel services'});
  expect(within(drawer).getByRole('link',{name:'Flight'}).getAttribute('href')).toBe('/app/flights');
  expect(document.activeElement).toBe(within(drawer).getByRole('button',{name:'Travel services'}));
  fireEvent.keyDown(document,{key:'Escape'});
  expect(screen.queryByRole('dialog',{name:'Travel services'})).toBeNull();
  expect(document.activeElement).toBe(screen.getByRole('button',{name:'Open travel services'}));
 });
 it('opens the account menu and closes it with Escape',()=>{render(<MemoryRouter><PremiumNavbar name="Shahid"/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'My Flyseri account'}));const menu=screen.getByRole('navigation',{name:'Account navigation'});for(const [label,path] of [['My Trips','/app/trips'],['My Orders','/app/orders'],['Support','/app/support'],['Profile','/app/profile']])expect(within(menu).getByRole('link',{name:label}).getAttribute('href')).toBe(path);expect(screen.getByRole('button',{name:'Sign out'})).toBeTruthy();fireEvent.keyDown(document,{key:'Escape'});expect(screen.queryByRole('navigation',{name:'Account navigation'})).toBeNull();expect(document.activeElement).toBe(screen.getByRole('button',{name:'My Flyseri account'}));});
 it('signs out from the profile menu',async()=>{auth.signOut.mockResolvedValue(undefined);render(<MemoryRouter initialEntries={['/app/visa']}><PremiumNavbar name="Shahid"/></MemoryRouter>);fireEvent.click(screen.getByRole('button',{name:'My Flyseri account'}));fireEvent.click(screen.getByRole('button',{name:'Sign out'}));await waitFor(()=>expect(auth.signOut).toHaveBeenCalledTimes(1));await waitFor(()=>expect(screen.queryByRole('navigation',{name:'Account navigation'})).toBeNull());});
});
