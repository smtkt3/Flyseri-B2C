// @vitest-environment jsdom
import { afterEach, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { MemoryRouter, useLocation } from 'react-router-dom';
import { TravelServiceNavigation, serviceIsActive } from './TravelServiceNavigation';
import { TravelServicesDrawer } from './TravelServicesDrawer';
import { useBackStepState } from './useBackStepState';
afterEach(cleanup);
function DrawerJourney(){const location=useLocation();const [open,setOpen]=useBackStepState('services-drawer',false);return <><button onClick={()=>setOpen(true)}>Open services</button><p>{location.pathname}</p><TravelServicesDrawer open={open} onClose={()=>setOpen(false)}/></>;}
it('navigates from an open history-backed drawer without a competing Back action',()=>{
 render(<MemoryRouter initialEntries={['/app/bookings']}><DrawerJourney/></MemoryRouter>);
 fireEvent.click(screen.getByRole('button',{name:'Open services'}));
 fireEvent.click(screen.getByRole('link',{name:'Visa'}));
 expect(screen.getByText('/app/visa')).toBeTruthy();expect(screen.queryByRole('dialog')).toBeNull();
});
it('keeps available services and support identical on home and account menus',()=>{
 const menu=(path:string,drawer=false)=>render(<MemoryRouter initialEntries={[path]}>{drawer?<TravelServicesDrawer open onClose={vi.fn()}/>:<TravelServiceNavigation id="desktop-services"/>}</MemoryRouter>);
 menu('/');
 const desktop=screen.getAllByRole('link').map(el=>el.getAttribute('aria-label'));
 expect(desktop).toEqual(['Flight','Packages','Visa','Help and support']);
 expect(screen.getByRole('link',{name:'Flight'}).getAttribute('href')).toBe('/#book');
 cleanup();menu('/app/bookings',true);
 expect(screen.getAllByRole('link').map(el=>el.getAttribute('aria-label'))).toEqual(desktop);
 expect(screen.getByRole('link',{name:'Flight'}).getAttribute('href')).toBe('/flights');
 expect(screen.getByText('More services · coming soon').closest('details')?.open).toBe(false);
 expect(screen.queryByRole('link',{name:'Hotels'})).toBeNull();
});
it.each([['/flights','flight'],['/app/flights/booking-intents/a','flight'],['/holidays/a','packages'],['/app/visa/assistance','visa'],['/app/visa-applications/a','visa']] as const)('marks %s consistently', (path,kind)=>{
 expect(serviceIsActive(path,kind)).toBe(true);
});
it('closes the drawer with Escape and restores focus through its callback',()=>{
 const close=vi.fn(),closed=vi.fn();
 render(<MemoryRouter><TravelServicesDrawer open onClose={close} onClosed={closed}/></MemoryRouter>);
 fireEvent.keyDown(document,{key:'Escape'});
 expect(close).toHaveBeenCalledOnce();expect(closed).toHaveBeenCalledOnce();
});
