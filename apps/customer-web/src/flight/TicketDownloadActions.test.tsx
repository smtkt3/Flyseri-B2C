// @vitest-environment jsdom
import {afterEach,beforeEach,it,expect,vi} from 'vitest';
import {render,screen,fireEvent,cleanup,waitFor,act} from '@testing-library/react';
import type {FlightBooking} from '@flyseri/types';
import {TicketDownloadActions} from './TicketDownloadActions';
const api=vi.hoisted(()=>({ticketPdf:vi.fn(),ticketDelivery:vi.fn()}));vi.mock('../services/flightService',()=>({flightService:api}));
const booking={id:'one',updatedAt:'2026-11-01T00:00:00Z',status:'TICKETED',pnr:'ABC123',passengerNames:['Test Traveler'],providerView:{flights:[{status:'Confirmed'}],tickets:[{number:'9970000000001',status:'Issued',travellerIndex:1,couponStatuses:['Okay']}]}} as FlightBooking;
beforeEach(()=>{vi.clearAllMocks();api.ticketDelivery.mockResolvedValue({emailStatus:'SENT'});api.ticketPdf.mockResolvedValue(new Blob(['%PDF-test'],{type:'application/pdf'}));Object.defineProperty(URL,'createObjectURL',{configurable:true,value:vi.fn(()=>'blob:ticket')});Object.defineProperty(URL,'revokeObjectURL',{configurable:true,value:vi.fn()});});afterEach(cleanup);
it('offers a PDF download after issuance and shows the email receipt',async()=>{
 const click=vi.spyOn(HTMLAnchorElement.prototype,'click').mockImplementation(()=>{});render(<TicketDownloadActions booking={booking}/>);await screen.findByText('A ticket copy was sent to your booking email.');fireEvent.click(screen.getByRole('button',{name:'Download e-ticket PDF'}));await waitFor(()=>expect(api.ticketPdf).toHaveBeenCalledWith('one'));await waitFor(()=>expect(click).toHaveBeenCalledOnce());click.mockRestore();
});
it.each(['PAID','MANUAL_REVIEW_REQUIRED','CANCELLED'])('does not offer a ticket for %s',status=>{render(<TicketDownloadActions booking={{...booking,status}}/>);expect(screen.queryByRole('button')).toBeNull();expect(api.ticketPdf).not.toHaveBeenCalled();});
it('hides voided tickets and a server-disabled document',()=>{const {rerender}=render(<TicketDownloadActions booking={{...booking,ticketDocumentAvailable:false}}/>);expect(screen.queryByRole('button')).toBeNull();rerender(<TicketDownloadActions booking={{...booking,providerView:{...booking.providerView!,tickets:[{number:'9970000000001',status:'Voided',travellerIndex:1}]}}}/>);expect(screen.queryByRole('button')).toBeNull();});
it('shows a recoverable error if the protected PDF request fails',async()=>{api.ticketPdf.mockRejectedValue(Error('Expired login'));render(<TicketDownloadActions booking={booking}/>);fireEvent.click(screen.getByRole('button',{name:'Download e-ticket PDF'}));expect(await screen.findByRole('alert')).toBeTruthy();expect(URL.createObjectURL).not.toHaveBeenCalled();});
it('does not download an old booking document after navigation to another booking',async()=>{
 let finish!:(value:Blob)=>void;api.ticketPdf.mockReturnValue(new Promise(resolve=>{finish=resolve;}));
 const {rerender}=render(<TicketDownloadActions booking={booking}/>);fireEvent.click(screen.getByRole('button',{name:'Download e-ticket PDF'}));rerender(<TicketDownloadActions booking={{...booking,id:'two'}}/>);
 await act(async()=>finish(new Blob(['%PDF-old'])));expect(URL.createObjectURL).not.toHaveBeenCalled();expect(screen.getByRole('button',{name:'Download e-ticket PDF'})).toBeTruthy();
});
