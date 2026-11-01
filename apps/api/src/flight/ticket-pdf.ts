import PDFDocument from 'pdfkit';
import {fileURLToPath} from 'node:url';
import {existsSync} from 'node:fs';
import {resolve} from 'node:path';
import type {FlightBooking} from '@flyseri/types';
import {hasExchangedCouponEvidence} from './reservation-evidence.js';
import {ticketDocumentAvailable} from './ticket-document.contract.js';

export const ticketAsset=(name:string)=>{
 if(!['LiberationSans-Regular.ttf','LiberationSans-Bold.ttf','flyseri-logo.png'].includes(name))throw Error('Unknown ticket asset');
 const candidates=[fileURLToPath(new URL('../../assets/tickets/'+name,import.meta.url)),resolve(process.cwd(),'apps/api/assets/tickets',name),resolve(process.cwd(),'assets/tickets',name)];
 const asset=candidates.find(path=>existsSync(path));if(!asset)throw Error('Ticket document asset is unavailable');return asset;
};
const navy='#163452',blue='#087cc1',muted='#60758a',line='#dce5ee';
const safe=(value:string)=>value.replace(/[\x00-\x1f]/g,' ').slice(0,500);
export async function createTicketPdf(booking:FlightBooking,environment:'CERT'|'PROD'):Promise<Buffer>{
 if(!ticketDocumentAvailable(booking))throw Error('Verified current issued tickets are required');
 const doc=new PDFDocument({size:'A4',margin:42,bufferPages:true,info:{Title:'Flyseri e-ticket itinerary - '+booking.pnr,Author:'Flyseri',Subject:environment==='CERT'?'CERT test document - not valid for travel':'Electronic ticket itinerary'}});
 doc.registerFont('Body',ticketAsset('LiberationSans-Regular.ttf'));doc.registerFont('Bold',ticketAsset('LiberationSans-Bold.ttf'));
 const chunks:Buffer[]=[];const output=new Promise<Buffer>((resolve,reject)=>{doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);});
 const width=511;let y=0,continuation='';
 function text(value:string,x:number,top:number,size=10,bold=false,w=width,color=navy){doc.font(bold?'Bold':'Body').fontSize(size).fillColor(color).text(safe(value),x,top,{width:w,lineGap:2});return doc.y;}
 function header(continued=false){
  doc.save().rect(42,24,145,48).clip().image(ticketAsset('flyseri-logo.png'),42,-29,{width:145}).restore();
  text('E-TICKET ITINERARY',270,35,15,true,283);text('Booking reference  '+booking.pnr,270,60,10,true,283);
  doc.moveTo(42,88).lineTo(553,88).strokeColor(line).stroke();y=102;
  if(environment==='CERT'){doc.rect(42,y,width,29).fill('#fff4df');text('SABRE CERT TEST DOCUMENT - NOT VALID FOR TRAVEL',52,y+9,9,true,491,'#875711');y+=43;}
  if(continued){y=text(continuation,42,y,10,true,511)+18;}
 }
 function space(height:number){if(y+height>738){doc.addPage();header(true);}}
 function paragraph(value:string,size=9){const height=doc.font('Body').fontSize(size).heightOfString(safe(value),{width,lineGap:2});space(height+9);y=text(value,42,y,size,false,width,muted)+9;}
 const legs=booking.selectedOffer.multiCityLegs??[booking.selectedOffer.outbound,...(booking.selectedOffer.inbound?[booking.selectedOffer.inbound]:[])],segments=legs.flatMap(leg=>leg.segments);
 const tickets=booking.providerView!.tickets.filter(ticket=>!hasExchangedCouponEvidence(ticket));
 for(const [passengerIndex,name] of booking.passengerNames.entries()){
  if(passengerIndex)doc.addPage();header();const ticket=tickets.find(value=>value.travellerIndex===passengerIndex+1)!;
  continuation=name+' | '+ticket.number+' | continued';
  text('PASSENGER',42,y,8,true,320,muted);y=text(name.toUpperCase(),42,y+16,15,true,511)+16;
  doc.roundedRect(42,y,width,55,5).fill('#eff6fb');text('E-ticket number',55,y+11,8,false,230,muted);text(ticket.number.replace(/^(\d{3})(\d{10})$/,'$1 $2'),55,y+27,13,true,280);text('Status: ISSUED',385,y+22,10,true,153,blue);y+=75;
  text('FLIGHT DETAILS',42,y,9,true);y+=22;
  for(const [index,segment] of segments.entries()){
   space(118);text('FLIGHT '+(index+1)+'   '+segment.marketingCarrier+' '+segment.flightNumber,42,y,9,true,340,blue);
   const details=[booking.selectedOffer.cabin?.replaceAll('_',' '),segment.bookingClass?'Class '+segment.bookingClass:null].filter(Boolean).join(' / ');text(details,350,y,8,false,203,muted);y+=22;
   text(segment.origin,42,y,22,true,180);text('TO',251,y+5,8,true,40,muted);text(segment.destination,312,y,22,true,220);y+=30;
   const date=(value:string)=>new Intl.DateTimeFormat('en-GB',{day:'2-digit',month:'short',year:'numeric',timeZone:'UTC'}).format(new Date(value.slice(0,10)+'T12:00:00Z'));
   text(date(segment.departureAt)+'  '+segment.departureAt.slice(11,16),42,y,11,true,250);text(date(segment.arrivalAt)+'  '+segment.arrivalAt.slice(11,16),312,y,11,true,241);y+=18;
   const offset=(value:string)=>value.endsWith('Z')?'+00:00':/([+-]\d{2}:\d{2})$/.exec(value)?.[1];
   text('Departure local time'+(offset(segment.departureAt)?' (UTC'+offset(segment.departureAt)+')':''),42,y,8,false,250,muted);text('Arrival local time'+(offset(segment.arrivalAt)?' (UTC'+offset(segment.arrivalAt)+')':''),312,y,8,false,241,muted);y+=17;
   if(segment.operatingCarrier&&segment.operatingCarrier!==segment.marketingCarrier){text('Operated by '+segment.operatingCarrier,42,y,8,false,511,muted);y+=17;}
   doc.moveTo(42,y).lineTo(553,y).strokeColor(line).stroke();y+=18;
  }
  space(58);text('BAGGAGE & SERVICES',42,y,9,true);y+=20;
  paragraph(booking.selectedOffer.baggageSummary||'Baggage allowance: check the airline confirmation for your ticket and fare.');
  const extras=booking.ancillaryPurchase?.items.filter(item=>item.passengerIndexes.includes(passengerIndex)&&item.refundStatus!=='REFUNDED')??[];
  for(const extra of extras)paragraph(extra.name+' - '+(booking.ancillaryPurchase?.status==='FULFILLED'?'extra-service document verified':'extra-service document not yet verified'));
  space(80);text('BEFORE YOU TRAVEL',42,y,9,true);y+=19;
  paragraph('This is your electronic ticket itinerary, not a boarding pass. Complete airline check-in to obtain your boarding pass. Carry the travel documents required for your itinerary.');
  paragraph('All flight times are local. Schedules, check-in deadlines and baggage conditions are controlled by the airline. Review your booking for changes. Payment receipts and fare conditions are available separately in My bookings.');
 }
 const pages=doc.bufferedPageRange();
 for(let index=0;index<pages.count;index++){
  doc.switchToPage(index);doc.moveTo(42,764).lineTo(553,764).strokeColor(line).stroke();
  text('Flyseri  |  '+booking.pnr+'  |  '+(environment==='CERT'?'CERT - NOT VALID FOR TRAVEL':'E-ticket itinerary'),42,776,8,false,430,muted);
  text((index+1)+' / '+pages.count,505,776,8,false,48,muted);
 }
 doc.end();return output;
}
