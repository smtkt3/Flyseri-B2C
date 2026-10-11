// @vitest-environment jsdom
import { afterEach,beforeEach,expect,it,vi } from 'vitest';
import { cleanup,fireEvent,render,screen } from '@testing-library/react';
import { MemoryRouter,Route,Routes } from 'react-router-dom';
import { DemoBookingManagement } from './DemoBookingManagement';
import { createDemoBooking,readDemoBookings } from '../services/demo/demoBookingService';
vi.mock('../components/PremiumNavbar',()=>({PremiumNavbar:()=>null}));
vi.mock('../lib/downloadText',()=>({downloadText:vi.fn()}));
beforeEach(()=>{sessionStorage.clear();});afterEach(cleanup);
function open(path='/demo/bookings'){render(<MemoryRouter initialEntries={[path]}><Routes><Route path="/demo/bookings" element={<DemoBookingManagement/>}/><Route path="/demo/bookings/:demoId" element={<DemoBookingManagement/>}/></Routes></MemoryRouter>);}
it('completes reservation → demo payment → document → refund and restores the saved result',async()=>{
  open();fireEvent.change(screen.getByLabelText('Travel date'),{target:{value:screen.getByLabelText('Travel date').querySelectorAll('option')[1]!.value}});
  fireEvent.click(screen.getByRole('button',{name:'Reserve demo flight'}));
  await screen.findByText('Reserved · demo payment due');
  fireEvent.click(screen.getByLabelText('I reviewed the demo total and sample passengers.'));
  fireEvent.click(screen.getByRole('button',{name:/^Pay .*demo$/}));
  await screen.findByText('Demo payment confirmed');
  expect(screen.queryByRole('button',{name:/^Pay .*demo$/})).toBeNull();
  fireEvent.click(screen.getByRole('button',{name:'Prepare demo ticket document'}));
  await screen.findByRole('button',{name:'Download demo document'});
  fireEvent.click(screen.getByLabelText('I confirm this demo refund.'));
  fireEvent.click(screen.getByRole('button',{name:'Simulate refund & cancellation'}));
  await screen.findByText('Demo refund complete');
  const saved=readDemoBookings()[0]!;expect(saved.paymentAttempts).toBe(1);expect(saved.status).toBe('REFUNDED');
  cleanup();open('/demo/bookings/'+saved.id);await screen.findByText('Demo refund complete');
});
it('supports a declined payment retry and pending confirmation without another pay button',async()=>{
 const value=createDemoBooking({destination:'KUL',city:'Kuala Lumpur',departure:new Date(Date.now()+86400000).toISOString().slice(0,10),travellers:1,amountPerPerson:22500,currency:'BDT'});
 open('/demo/bookings/'+value.id);await screen.findByText('Reserved · demo payment due');
 fireEvent.change(screen.getByLabelText('Test payment outcome'),{target:{value:'PAY_FAILURE'}});
 fireEvent.click(screen.getByLabelText('I reviewed the demo total and sample passengers.'));fireEvent.click(screen.getByRole('button',{name:/^Pay .*demo$/}));
 await screen.findByText('Demo payment declined');
 fireEvent.change(screen.getByLabelText('Test payment outcome'),{target:{value:'PAY_PENDING'}});fireEvent.click(screen.getByLabelText('I reviewed the demo total and sample passengers.'));fireEvent.click(screen.getByRole('button',{name:/^Pay .*demo$/}));
 await screen.findByText('Demo payment pending');expect(screen.queryByRole('button',{name:/^Pay .*demo$/})).toBeNull();
 fireEvent.click(screen.getByRole('button',{name:'Simulate approval'}));await screen.findByText('Demo payment confirmed');expect(readDemoBookings()[0]?.paymentAttempts).toBe(2);
});
