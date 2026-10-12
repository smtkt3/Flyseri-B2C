// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { MemoryRouter } from 'react-router-dom';
import { PointsPage } from './PointsPage';
import { PointsCheckout } from './PointsCheckout';
import { DemoPointsPage } from './DemoPointsPage';
import { demoPointsTransition, initialDemoPoints } from '../services/demo/demoPointsService';
const service=vi.hoisted(()=>({wallet:vi.fn(),quote:vi.fn(),apply:vi.fn()}));
vi.mock('../services/pointsService',()=>({pointsService:service}));
vi.mock('../components/PremiumNavbar',()=>({PremiumNavbar:()=>null}));
afterEach(()=>{cleanup();vi.resetAllMocks();});
describe('Flyseri Points customer experience',()=>{
  it('shows the exact BDT 1,000 earning rule and accessible empty wallet',async()=>{
    service.wallet.mockResolvedValue({...initialDemoPoints().wallet,available:0,pending:0,reserved:0,activity:[]});
    render(<MemoryRouter><PointsPage/></MemoryRouter>);
    await screen.findByRole('heading',{name:'Flyseri Points'});
    expect(screen.getByText(/^1 point for every BDT 1,000/)).toBeTruthy();expect(screen.getByText('Your journeys will appear here')).toBeTruthy();
    expect(screen.getByRole('link',{name:'Open the separate points demo'})).toBeTruthy();
    expect(screen.getByRole('heading',{name:'No points yet. Your journey starts here.'})).toBeTruthy();
    expect(screen.getByRole('link',{name:'Find a flight & start earning'}).getAttribute('href')).toBe('/flights');
    expect(screen.queryByRole('alert')).toBeNull();
  });
  it('shows pending rewards without describing them as an empty wallet',async()=>{
    service.wallet.mockResolvedValue({...initialDemoPoints().wallet,available:0,pending:25});
    render(<MemoryRouter><PointsPage/></MemoryRouter>);
    await screen.findByText(/Your points are on their way/);
    expect(screen.queryByRole('heading',{name:'No points yet. Your journey starts here.'})).toBeNull();
  });
  it('shows recoverable errors without inventing a balance',async()=>{
    service.wallet.mockRejectedValueOnce(new Error()).mockResolvedValue(initialDemoPoints().wallet);
    render(<MemoryRouter><PointsPage/></MemoryRouter>);
    await screen.findByRole('alert');expect(screen.queryByText('500')).toBeNull();expect(screen.queryByText('No points yet. Your journey starts here.')).toBeNull();fireEvent.click(screen.getByRole('button',{name:'Try again'}));
    await screen.findByText('500');
  });
  it('locks payment during applying points, refreshes totals, and shows a readable success',async()=>{
    const quote={rules:initialDemoPoints().wallet.rules,orderId:'order1',eligible:true,available:500,maximum:500,applied:0,estimatedEarn:25,eligibleAmount:'25000.00',message:'Earn 1 point per BDT 1,000.'};
    service.quote.mockResolvedValue(quote);service.apply.mockResolvedValue({...quote,applied:100,available:400,estimatedEarn:24});
    const changed=vi.fn().mockResolvedValue(undefined),busy=vi.fn();
    render(<MemoryRouter><PointsCheckout orderId="order1" locked={false} onChanged={changed} onBusy={busy}/></MemoryRouter>);
    const input=await screen.findByLabelText('Points to use');fireEvent.change(input,{target:{value:'100'}});fireEvent.click(screen.getByRole('button',{name:'Apply points'}));
    await screen.findByText('100 points applied · BDT 100 saved');expect(service.apply).toHaveBeenCalledWith('order1',100);expect(changed).toHaveBeenCalledOnce();expect(busy.mock.calls).toEqual([[true],[false]]);
  });
  it('does not offer real redemption for sandbox payments',async()=>{
    service.quote.mockResolvedValue({eligible:false,applied:0,message:'Test bookings do not earn or spend real points.'});
    render(<MemoryRouter><PointsCheckout orderId="order1" locked={false} onChanged={vi.fn()} onBusy={vi.fn()}/></MemoryRouter>);
    await screen.findByText('Test bookings do not earn or spend real points.');expect(screen.queryByRole('button',{name:'Apply points'})).toBeNull();
  });
  it('rehearses earning, verified travel, redemption and refund without calling the API',async()=>{
    render(<MemoryRouter><DemoPointsPage/></MemoryRouter>);
    fireEvent.click(screen.getByRole('button',{name:'1. Simulate redemption'}));await screen.findByText('400');
    fireEvent.click(screen.getByRole('button',{name:'2. Simulate paid ticket'}));expect(screen.getByText('24')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'3. Simulate travel + 7 days'}));expect(screen.getByText('424')).toBeTruthy();
    fireEvent.click(screen.getByRole('button',{name:'Simulate full refund'}));await screen.findByText('500');
    await waitFor(()=>expect(service.wallet).not.toHaveBeenCalled());expect(service.apply).not.toHaveBeenCalled();
  });
  it('rejects invalid demo redemptions and repeat transitions',()=>{
    expect(()=>demoPointsTransition(initialDemoPoints(),'REDEEM',99)).toThrow();expect(()=>demoPointsTransition(initialDemoPoints(),'REDEEM',501)).toThrow();
    const state=demoPointsTransition(initialDemoPoints(),'PURCHASE');expect(()=>demoPointsTransition(state,'PURCHASE')).toThrow();expect(()=>demoPointsTransition(state,'REDEEM',100)).toThrow();
  });
});
