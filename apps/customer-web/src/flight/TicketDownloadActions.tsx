import {useEffect,useRef,useState} from 'react';
import type {FlightBooking} from '@flyseri/types';
import {flightService} from '../services/flightService';
import {bookingHasIssuedTickets,bookingHasCancelledSegments} from './bookingPresentation';
import './ticket-download.css';

export function TicketDownloadActions({booking,compact=false}:{booking:FlightBooking;compact?:boolean}){
 const [busy,setBusy]=useState(false),[error,setError]=useState(''),[email,setEmail]=useState('');
 const current=useRef(''),running=useRef<string|null>(null);current.current=booking.id+booking.updatedAt;
 const available=booking.status==='TICKETED'&&!bookingHasCancelledSegments(booking)&&bookingHasIssuedTickets(booking)&&booking.ticketDocumentAvailable!==false;
 useEffect(()=>{let active=true;current.current=booking.id+booking.updatedAt;setBusy(false);setEmail('');setError('');if(available&&!compact)void(async()=>{try{const value=await flightService.ticketDelivery(booking.id);if(active)setEmail(value.emailStatus);}catch{/* Download remains available if email status is unavailable. */}})();return()=>{active=false;current.current='';};},[booking.id,booking.updatedAt,available,compact]);
 if(!available)return null;
 async function download(){
  const version=current.current;if(running.current===version)return;running.current=version;setBusy(true);setError('');
  try{
   const blob=await flightService.ticketPdf(booking.id);if(current.current!==version)return;
   const url=URL.createObjectURL(blob),link=document.createElement('a');link.href=url;link.download='Flyseri-e-ticket-'+(booking.pnr??booking.id).replace(/[^A-Z0-9-]/gi,'')+'.pdf';document.body.append(link);link.click();link.remove();window.setTimeout(()=>URL.revokeObjectURL(url),1000);
  }catch{if(current.current===version)setError('We couldn’t download your ticket. Please try again or contact support.');}
  finally{if(running.current===version)running.current=null;if(current.current===version)setBusy(false);}
 }
 return <div className={'ticket-download-actions'+(compact?' is-compact':'')}><button type="button" className="account-outline-button" disabled={busy} onClick={()=>void download()}>{busy?'Preparing ticket…':'Download e-ticket PDF'}</button>{!compact&&<small>{email==='SENT'?'A ticket copy was sent to your booking email.':email==='QUEUED'?'Your email copy is being prepared.':email==='REVIEW_REQUIRED'?'Your PDF is ready. Contact support to check the email copy.':'Flyseri PDF · current issued tickets'}</small>}{error&&<p role="alert">{error}</p>}</div>;
}
